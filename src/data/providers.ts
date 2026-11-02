// Labels, secret names and model suggestions for model providers. A CATALOGUE kept by hand, not a live check.
//
// Which providers can be chosen, and whether their key is set, comes from the server (GET /providers, see
// hooks/useProviders.ts): a provider in this file is only offered when the server reports it installed for that stage.
// There is no fallback list of providers: when the server cannot be asked, the pickers say the list could not be checked.
// Model ids are suggestions; the provider decides what an account can use, and every picker also takes any other id
// (the server doesn't check model ids). Voices are in voiceCatalog.ts (the API has no voice list). Secret names match
// the `default_secret` GET /providers reports.

export interface ProviderModel {
  id: string;
  label: string;
  note?: string;
  tags?: string[];
}

export interface ProviderOption {
  id: string;
  label: string;
  secret: string;
  models: ProviderModel[];
}

/** When the model table below was last reviewed by hand. */
export const CATALOGUE_REVIEWED = '2026-10-14';

/** Display names for provider ids GET /providers can report. */
export const providerLabels: Record<string, string> = {
  openai: 'OpenAI',
  openai_compatible: 'OpenAI-compatible',
  anthropic: 'Anthropic',
  google: 'Google',
  groq: 'Groq',
  deepgram: 'Deepgram',
  assemblyai: 'AssemblyAI',
  cartesia: 'Cartesia',
  elevenlabs: 'ElevenLabs',
  silero: 'Silero',
  // turn detectors
  'livekit-multilingual': 'LiveKit multilingual',
  'livekit-english': 'LiveKit English',
};

/** A provider id in words: its label, else the id made readable ("some_new-provider" -> "Some New Provider"). */
export const providerLabel = (provider = ''): string =>
  providerLabels[String(provider).toLowerCase()] ??
  String(provider)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

/** The usual name of each provider's key in the server's vault. The server's own answer (default_secret) wins. */
export const providerSecrets: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  groq: 'GROQ_API_KEY',
  deepgram: 'DEEPGRAM_API_KEY',
  assemblyai: 'ASSEMBLYAI_API_KEY',
  cartesia: 'CARTESIA_API_KEY',
  elevenlabs: 'ELEVEN_API_KEY',
};

export type ModelStage = 'stt' | 'llm' | 'tts';

const m = (id: string, label: string, note: string, tags: string[] = []): ProviderModel => ({ id, label, note, tags });

/**
 * The models offered for each part of a call, by provider. The first model of a provider is the one chosen with it
 * (marked "Recommended"). An empty list means any id is typed in (an OpenAI-compatible service serves its own).
 */
export const MODEL_OPTIONS: Record<ModelStage, Record<string, ProviderModel[]>> = {
  stt: {
    openai: [
      m('gpt-4o-transcribe', 'GPT-4o Transcribe', 'High-accuracy speech recognition', ['accurate']),
      m('gpt-4o-mini-transcribe', 'GPT-4o mini Transcribe', 'Lower latency, costs less', ['fast']),
      m('gpt-realtime-whisper', 'GPT Realtime Whisper', 'Streaming transcription for live calls', ['live calls']),
      m('whisper-1', 'Whisper 1', 'General-purpose transcription'),
      m('gpt-4o-transcribe-diarize', 'GPT-4o Transcribe Diarize', 'Transcription with speaker labels'),
    ],
    deepgram: [
      m('nova-3', 'Nova 3', 'Latest-generation speech recognition', ['accurate', 'live calls']),
      m('nova-2', 'Nova 2', 'Balanced accuracy and speed'),
      m('nova-2-general', 'Nova 2 General', 'General conversation transcription'),
      m('nova-2-phonecall', 'Nova 2 Phonecall', 'Made for telephone audio', ['phone']),
    ],
    assemblyai: [m('universal-streaming', 'Universal streaming', 'Real-time streaming transcription')],
    cartesia: [m('ink-whisper', 'Ink Whisper', 'Cartesia’s streaming speech recognition')],
    elevenlabs: [m('scribe_v1', 'Scribe v1', 'ElevenLabs speech recognition')],
    google: [m('chirp_2', 'Chirp 2', 'Multilingual speech recognition'), m('latest_long', 'Latest Long', 'Long-form conversation')],
    groq: [
      m('whisper-large-v3', 'Whisper Large v3', 'High-accuracy multilingual recognition'),
      m('whisper-large-v3-turbo', 'Whisper Large v3 Turbo', 'Faster large-model variant'),
    ],
    openai_compatible: [],
  },
  llm: {
    openai: [
      m('gpt-4.1-mini', 'GPT-4.1 mini', 'Fast and low cost. Recommended for most agents.'),
      m('gpt-4.1', 'GPT-4.1', 'Most capable of the 4.1 family. Slower and costs more per call.'),
      m('gpt-4o-mini', 'GPT-4o mini', 'Cheapest. Fine for simple scripted flows.', ['fast']),
      m('gpt-5.4', 'GPT-5.4', 'Advanced reasoning and complex tasks', ['most capable']),
      m('gpt-5.4-mini', 'GPT-5.4 mini', 'Balanced speed and capability'),
      m('gpt-5.4-nano', 'GPT-5.4 nano', 'Lightweight, low-latency tasks', ['fast']),
    ],
    anthropic: [
      m('claude-sonnet-5-5', 'Claude Sonnet 5.5', 'Balanced quality and speed'),
      m('claude-haiku-5-5', 'Claude Haiku 5.5', 'Fastest, for low-latency replies', ['fast']),
      m('claude-opus-5-5', 'Claude Opus 5.5', 'Most capable, for complex tasks', ['most capable']),
    ],
    google: [
      m('gemini-2.0-flash', 'Gemini 2.0 Flash', 'Fast, good at long documents.'),
      m('gemini-2.5-flash', 'Gemini 2.5 Flash', 'Fast, general purpose'),
      m('gemini-2.5-pro', 'Gemini 2.5 Pro', 'Advanced reasoning'),
    ],
    groq: [
      m('llama-3.3-70b-versatile', 'Llama 3.3 70B', 'Capable open model, very low latency on Groq'),
      m('llama-3.1-8b-instant', 'Llama 3.1 8B', 'Lightweight, lowest latency', ['fast']),
    ],
    openai_compatible: [],
  },
  tts: {
    cartesia: [
      m('sonic-3', 'Sonic 3', 'Latest generation, natural and expressive'),
      m('sonic-2', 'Sonic 2', 'Previous generation, widely compatible'),
      m('sonic-turbo', 'Sonic Turbo', 'Lowest latency', ['fast']),
    ],
    elevenlabs: [
      m('eleven_flash_v2_5', 'Flash v2.5', 'Lowest latency, best for live calls', ['fast', 'live calls']),
      m('eleven_turbo_v2_5', 'Turbo v2.5', 'Fast, with higher quality than Flash'),
      m('eleven_multilingual_v2', 'Multilingual v2', 'Most natural across many languages; slower', ['multilingual']),
      m('eleven_v3', 'v3', 'Most expressive; slower, for quality over speed'),
    ],
    openai: [
      m('gpt-4o-mini-tts', 'GPT-4o mini TTS', 'Steerable, natural voices'),
      m('tts-1', 'TTS 1', 'Fast, standard quality'),
      m('tts-1-hd', 'TTS 1 HD', 'Higher quality'),
    ],
    deepgram: [m('aura-2-thalia-en', 'Aura 2 Thalia', 'English voice, Aura 2'), m('aura-asteria-en', 'Aura Asteria', 'English voice, Aura')],
    google: [],
    groq: [],
    openai_compatible: [],
  },
};

/** What each provider can do, by stage: the catalogue's own copy, used to check the table above (catalogueProblems). */
export const PROVIDER_STAGES: Record<string, ModelStage[]> = {
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

/** Providers with no list of their own: the model is whatever the service serves, so it is typed. */
export const FREE_TEXT_PROVIDERS: Record<string, string> = {
  openai_compatible: 'Any service that speaks the OpenAI API (Mistral, Azure, a model server of your own). Type the model id it serves.',
};

const optionsFor = (stage: ModelStage): ProviderOption[] =>
  Object.entries(MODEL_OPTIONS[stage])
    .filter(([, models]) => models.length > 0 || stage === 'llm')
    .filter(([id]) => id !== 'openai_compatible')
    .map(([id, models]) => ({ id, label: providerLabel(id), secret: providerSecrets[id] ?? '', models }));

/** The language-model providers with their suggested models (the first is the one chosen with the provider). */
export const llmProviders: ProviderOption[] = optionsFor('llm');

export const sttProviders: ProviderOption[] = optionsFor('stt');

// Voices are not listed here: see voiceCatalog.ts. The server requires a text-to-speech model with the provider. Only
// the providers the voice catalogue has voices for are suggested here (the guided setup picks from these); the pickers
// read MODEL_OPTIONS.
export const ttsProviders: ProviderOption[] = optionsFor('tts').filter((p) => p.id === 'cartesia' || p.id === 'elevenlabs');
