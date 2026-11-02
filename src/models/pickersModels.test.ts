import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import type { Provider } from '../api/types';
import { CATALOGUE_REVIEWED, MODEL_OPTIONS, llmProviders, providerLabel, sttProviders, ttsProviders } from '../data/providers';
import {
  SECRET_PATTERN,
  applyVoice,
  catalogueProblems,
  catalogueSize,
  defaultModelFor,
  defaultVoiceFor,
  modelFieldOptions,
  modelLabel,
  modelRows,
  modelStageOf,
  modelStatus,
  modelsFor,
  providerChips,
  providerOptionNote,
  providersForStage,
  readModels,
  secretFor,
  setModel,
  setProvider,
  setVoiceId,
  slotProblem,
  summarizeModels,
  voicesOf,
} from './pickersModels';

// What the server's own voice agent looks like.
const agent = (): AgentConfig => ({
  schema_version: '1.1',
  meta: { id: 'voice-test', name: 'Voice test', version: '1.0.1' },
  defaults: {
    models: {
      stt: { provider: 'openai', model: 'gpt-realtime-whisper', language: 'en', api_key: { secret: 'OPENAI_API_KEY' }, options: { x: 1 } },
      llm: { provider: 'openai', model: 'gpt-4.1-mini', api_key: { secret: 'OPENAI_API_KEY' }, fallbacks: [{ provider: 'openai', model: 'gpt-4o-mini' }] },
      tts: { provider: 'elevenlabs', model: 'eleven_flash_v2_5', voice_id: 'Z8dg0fyk7p6js7cQ7lgi', text_transforms: ['filter_markdown'], api_key: { secret: 'ELEVEN_API_KEY' } },
      vad: { provider: 'silero' },
    },
  },
});

// A trimmed copy of what GET /providers answers.
const SERVER: Provider[] = [
  { name: 'openai', stages: ['stt', 'llm', 'tts', 'realtime'], installed: true, default_secret: 'OPENAI_API_KEY', key_available: true },
  { name: 'groq', stages: ['stt', 'llm', 'tts'], installed: false, default_secret: 'GROQ_API_KEY', key_available: false },
  { name: 'deepgram', stages: ['stt', 'tts'], installed: true, default_secret: 'DEEPGRAM_SERVER_KEY', key_available: false },
  { name: 'anthropic', stages: ['llm'], installed: true, default_secret: 'ANTHROPIC_API_KEY', key_available: false },
  { name: 'silero', stages: ['vad'], installed: true, default_secret: null, key_available: false },
];

describe('the model catalogue', () => {
  it('is consistent: no provider listed for a stage it can’t do, nothing missing, no duplicates', () => {
    expect(catalogueProblems()).toEqual([]);
    expect(CATALOGUE_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(catalogueSize()).toBeGreaterThanOrEqual(40);
  });

  it('a default model comes with every provider that has a list, and is in that list', () => {
    Object.entries(MODEL_OPTIONS).forEach(([stage, byProvider]) =>
      Object.entries(byProvider).forEach(([provider, models]) => {
        const s = stage as 'stt' | 'llm' | 'tts';
        if (!models.length) expect(defaultModelFor(s, provider)).toBe('');
        else expect(models.some((m) => m.id === defaultModelFor(s, provider))).toBe(true);
      }),
    );
    expect(MODEL_OPTIONS.llm.openai_compatible).toEqual([]);
    expect(modelsFor('stt', 'openai').some((m) => m.id === 'gpt-realtime-whisper')).toBe(true);
    expect(modelsFor('llm', 'anthropic').length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the suggestions the guided setup has always started from', () => {
    expect(llmProviders.find((p) => p.id === 'openai')?.models[0].id).toBe('gpt-4.1-mini');
    expect(sttProviders.find((p) => p.id === 'openai')?.models[0].id).toBe('gpt-4o-transcribe');
    expect(ttsProviders.map((p) => p.id)).toEqual(['cartesia', 'elevenlabs']);
    expect(ttsProviders.find((p) => p.id === 'elevenlabs')?.secret).toBe('ELEVEN_API_KEY');
  });

  it('a model is listed, typed by someone, from a provider with no list, or not chosen', () => {
    expect(modelStatus('llm', 'openai', 'gpt-4.1').state).toBe('listed');
    const custom = modelStatus('llm', 'openai', 'gpt-9-ultra');
    expect(custom.state).toBe('custom');
    expect(custom.text).toMatch(/isn’t in the catalogue/);
    expect(custom.text).toMatch(/doesn’t check model ids/);
    expect(modelStatus('llm', 'openai_compatible', 'mistral-small-latest').state).toBe('free');
    expect(modelStatus('tts', 'google', 'anything').state).toBe('free');
    expect(modelStatus('llm', 'openai', '').state).toBe('empty');
  });

  it('names, labels and secret names (the server’s own name wins)', () => {
    expect(providerLabel('openai_compatible')).toBe('OpenAI-compatible');
    expect(providerLabel('some_new-provider')).toBe('Some New Provider');
    expect(modelLabel('stt', 'openai', 'gpt-realtime-whisper')).toBe('GPT Realtime Whisper');
    expect(modelLabel('stt', 'openai', 'custom-model')).toBe('custom-model');
    expect(secretFor('deepgram')).toBe('DEEPGRAM_API_KEY');
    expect(secretFor('deepgram', SERVER)).toBe('DEEPGRAM_SERVER_KEY');
    expect(secretFor('azure openai')).toBe('AZURE_OPENAI_API_KEY');
    expect(secretFor('azure openai')).toMatch(SECRET_PATTERN);
  });
});

describe('the server’s list drives what is offered', () => {
  it('installed providers first, then by name; one not installed goes last', () => {
    expect(providersForStage(SERVER, 'stt').map((p) => p.name)).toEqual(['deepgram', 'openai', 'groq']);
    expect(providersForStage(SERVER, 'llm').map((p) => p.name)).toEqual(['anthropic', 'openai', 'groq']);
    expect(providersForStage(SERVER, 'vad').map((p) => p.name)).toEqual(['silero']);
  });

  it('without the server’s list nothing is offered as runnable: there is no list kept in the studio', () => {
    expect(providersForStage(null, 'llm')).toEqual([]);
    expect(modelRows({ stage: 'llm', providers: null })).toEqual([]);
    expect(providerChips({ stage: 'llm', providers: null })).toEqual([]);
    expect(slotProblem('llm', { provider: 'openai' }, null)).toBeNull();
  });

  it('what would stop a call: a provider the server can’t run here, or its key not set', () => {
    expect(slotProblem('llm', { provider: 'anthropic' }, SERVER)?.short).toBe('Key missing');
    expect(slotProblem('llm', { provider: 'anthropic' }, SERVER)?.text).toMatch(/ANTHROPIC_API_KEY/);
    expect(slotProblem('llm', { provider: 'groq' }, SERVER)?.short).toBe('Can’t run');
    expect(slotProblem('llm', { provider: 'mistral' }, SERVER)?.short).toBe('Can’t run');
    expect(slotProblem('tts', { provider: 'anthropic' }, SERVER)?.short).toBe('Can’t run');
    expect(slotProblem('llm', { provider: 'openai' }, SERVER)).toBeNull();
    expect(slotProblem('llm', { provider: '' }, SERVER)).toBeNull();
    expect(providerOptionNote(SERVER[1], 'llm')).toBe('groq · not installed on this server · no key set on the server');
  });

  it('the model list: the one in use first, a provider filter, a search, and what can’t run is marked', () => {
    const rows = modelRows({ stage: 'llm', providers: SERVER, current: { provider: 'openai', model: 'gpt-4.1' } });
    expect(rows[0]).toMatchObject({ provider: 'openai', id: 'gpt-4.1', selected: true });
    expect(rows.find((r) => r.provider === 'anthropic')?.keyMissing).toBe('ANTHROPIC_API_KEY');
    expect(rows.filter((r) => !r.installed).every((r) => r.provider === 'groq')).toBe(true);
    expect(rows.findIndex((r) => !r.installed)).toBeGreaterThan(rows.findIndex((r) => r.provider === 'anthropic'));
    expect(modelRows({ stage: 'llm', providers: SERVER, provider: 'anthropic' }).every((r) => r.provider === 'anthropic')).toBe(true);
    expect(modelRows({ stage: 'llm', providers: SERVER, query: 'haiku' }).map((r) => r.id)).toEqual(['claude-haiku-5-5']);
    expect(rows.find((r) => r.id === 'gpt-4.1-mini')?.recommended).toBe(true);
    expect(providerChips({ stage: 'tts', providers: SERVER }).map((c) => c.value)).toEqual(['deepgram', 'openai', 'groq'].filter((p) => modelsFor('tts', p).length));
  });
});

describe('reading and writing the models', () => {
  it('reads the three stages, and an agent with none set up reads as empty', () => {
    const read = readModels(agent());
    expect(read.stt).toEqual({ provider: 'openai', model: 'gpt-realtime-whisper', secret: 'OPENAI_API_KEY', baseUrl: '' });
    expect(read.tts).toEqual({ provider: 'elevenlabs', model: 'eleven_flash_v2_5', secret: 'ELEVEN_API_KEY', baseUrl: '', voiceId: 'Z8dg0fyk7p6js7cQ7lgi' });
    expect(readModels({}).stt).toEqual({ provider: '', model: '', secret: '', baseUrl: '' });
    expect(summarizeModels(agent()).map((s) => [s.label, s.providerName, s.modelName])).toEqual([
      ['Language model', 'OpenAI', 'GPT-4.1 mini'],
      ['Speech-to-text', 'OpenAI', 'GPT Realtime Whisper'],
      ['Text-to-speech', 'ElevenLabs', 'Flash v2.5'],
    ]);
    expect(summarizeModels({})[0].set).toBe(false);
  });

  it('choosing a provider selects its first model and its secret, keeps what still applies, drops what does not', () => {
    const config = agent();
    const next = setProvider(config, 'stt', 'deepgram');
    expect(next.defaults?.models?.stt).toEqual({ provider: 'deepgram', model: 'nova-3', language: 'en', api_key: { secret: 'DEEPGRAM_API_KEY' } });
    expect(config.defaults?.models?.stt?.provider).toBe('openai');
    expect(next.defaults?.models?.llm).toEqual(config.defaults?.models?.llm);
    expect(setProvider(config, 'stt', 'deepgram', SERVER).defaults?.models?.stt?.api_key).toEqual({ secret: 'DEEPGRAM_SERVER_KEY' });
  });

  it('a provider then a model: the new choice is what is read back; fallbacks still apply', () => {
    const start = setProvider(agent(), 'llm', 'anthropic');
    expect(readModels(start).llm).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5', secret: 'ANTHROPIC_API_KEY' });
    const picked = setModel(start, 'llm', 'claude-haiku-5-5');
    expect(summarizeModels(picked)[0].modelName).toBe('Claude Haiku 5.5');
    expect(start.defaults?.models?.llm?.fallbacks).toEqual(agent().defaults?.models?.llm?.fallbacks);
  });

  it('a service of your own gets no made-up key name, only the one the server names', () => {
    const own = setProvider(agent(), 'llm', 'openai_compatible');
    expect(own.defaults?.models?.llm?.model).toBeUndefined();
    expect(own.defaults?.models?.llm?.api_key).toBeUndefined();
    const named = setProvider(agent(), 'llm', 'openai_compatible', [{ name: 'openai_compatible', stages: ['llm'], installed: true, default_secret: 'MY_KEY' }]);
    expect(named.defaults?.models?.llm?.api_key).toEqual({ secret: 'MY_KEY' });
  });

  it('text-to-speech: switching provider switches model, key and voice together, starting on a female voice', () => {
    const tts = setProvider(agent(), 'tts', 'cartesia').defaults?.models?.tts;
    expect(tts).toMatchObject({ provider: 'cartesia', model: 'sonic-3', api_key: { secret: 'CARTESIA_API_KEY' }, text_transforms: ['filter_markdown'] });
    expect(tts?.voice_id).toBe(voicesOf('cartesia', 'Female')[0].voiceId);
    expect(defaultVoiceFor('elevenlabs')?.gender).toBe('Female');
    expect(defaultVoiceFor('nobody')).toBeUndefined();
  });

  it('a catalogue voice becomes the real voice: its engine, that engine’s model and key, and the voice id', () => {
    const config = agent();
    const same = applyVoice(config, { provider: 'ElevenLabs', voiceId: 'rachel-id' });
    expect(same.defaults?.models?.tts).toMatchObject({ voice_id: 'rachel-id', model: 'eleven_flash_v2_5' });
    const other = applyVoice(config, { provider: 'cartesia', voiceId: 'a167e0f3' });
    expect(other.defaults?.models?.tts).toMatchObject({ provider: 'cartesia', model: 'sonic-3', api_key: { secret: 'CARTESIA_API_KEY' }, voice_id: 'a167e0f3' });
    expect(config.defaults?.models?.tts?.voice_id).toBe('Z8dg0fyk7p6js7cQ7lgi');
  });

  it('choosing what is already chosen changes nothing, and any other model id or voice id can be typed', () => {
    const config = agent();
    expect(setProvider(config, 'stt', 'openai')).toBe(config);
    expect(setModel(config, 'llm', 'gpt-4.1-mini')).toBe(config);
    expect(setVoiceId(config, 'Z8dg0fyk7p6js7cQ7lgi')).toBe(config);
    expect(setModel(config, 'stt', '  my-own-model  ').defaults?.models?.stt?.model).toBe('my-own-model');
    expect(setModel(config, 'stt', '').defaults?.models?.stt?.model).toBeUndefined();
    expect(setVoiceId(config, 'my-own-voice-123').defaults?.models?.tts?.voice_id).toBe('my-own-voice-123');
  });
});

describe('the Provider and Model boxes of the full settings', () => {
  it('only the provider and the model of a speech, language or voice setting get a list; their fallbacks too', () => {
    expect(modelStageOf(['defaults', 'models', 'llm', 'provider'])).toBe('llm');
    expect(modelStageOf(['defaults', 'models', 'stt', 'model'])).toBe('stt');
    expect(modelStageOf(['defaults', 'models', 'tts', 'fallbacks', 0, 'provider'])).toBe('tts');
    expect(modelStageOf(['agents', 'items', 2, 'models', 'llm', 'model'])).toBe('llm');
    expect(modelStageOf(['defaults', 'models', 'llm', 'temperature'])).toBeNull();
    expect(modelStageOf(['knowledge', 0, 'embedding', 'model'])).toBeNull();
    expect(modelStageOf(['connections', 0, 'provider'])).toBeNull();
  });

  it('the list follows the stage and the provider beside it; nothing is listed without the server’s answer', () => {
    const providers = modelFieldOptions({ stage: 'llm', leaf: 'provider', providers: SERVER }).map((o) => o.value);
    expect(providers).toContain('openai');
    expect(providers).toContain('anthropic');
    expect(providers).not.toContain('deepgram');
    expect(modelFieldOptions({ stage: 'llm', leaf: 'provider', providers: null })).toEqual([]);
    const models = modelFieldOptions({ stage: 'llm', leaf: 'model', provider: 'openai', providers: SERVER });
    expect(models[0]).toMatchObject({ value: 'gpt-4.1-mini', label: 'GPT-4.1 mini · Recommended' });
    expect(modelFieldOptions({ stage: 'llm', leaf: 'model', provider: 'openai_compatible', providers: SERVER })).toEqual([]);
    expect(modelFieldOptions({ stage: 'turn_detector', leaf: 'provider', providers: SERVER, turnDetectors: ['livekit-english'] })).toEqual([{ value: 'livekit-english', label: 'LiveKit English', description: 'livekit-english' }]);
  });
});
