import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FALLBACK_PROVIDERS,
  MODEL_OPTIONS,
  PROVIDER_LABELS,
  RENAMED_PROVIDERS,
  STAGES,
  defaultModelFor,
  modelLabel,
  modelsFor,
  providerLabel,
  providersForStage,
  secretFor,
} from '../src/studio/models/catalog.js';
import {
  SECRET_PATTERN,
  applyRenamedProvider,
  applyVoice,
  readModels,
  renamedProvider,
  sameModels,
  setBaseUrl,
  setModel,
  setProvider,
  setSecret,
  setVoiceId,
  summarizeModels,
  voicesFor,
} from '../src/studio/models/config.js';

// What the server's own voice agent looks like.
const agent = () => ({
  schema_version: '1.1',
  meta: { id: 'voice-test', name: 'Voice test', version: '1.0.1' },
  defaults: {
    models: {
      stt: { provider: 'openai', model: 'gpt-realtime-whisper', language: 'en', api_key: { secret: 'OPENAI_API_KEY' }, options: { x: 1 } },
      llm: { provider: 'openai', model: 'gpt-4.1-mini', api_key: { secret: 'OPENAI_API_KEY' }, fallbacks: [{ provider: 'openai', model: 'gpt-4o-mini' }] },
      tts: {
        provider: 'elevenlabs',
        model: 'eleven_flash_v2_5',
        voice_id: 'Z8dg0fyk7p6js7cQ7lgi',
        text_transforms: ['filter_markdown'],
        api_key: { secret: 'ELEVEN_API_KEY' },
      },
      vad: { provider: 'silero' },
    },
    conversation: {},
  },
});

// A trimmed copy of what GET /providers answers.
const SERVER = [
  { name: 'openai', stages: ['stt', 'llm', 'tts', 'realtime'], installed: true, default_secret: 'OPENAI_API_KEY', key_available: true },
  { name: 'groq', stages: ['stt', 'llm', 'tts'], installed: false, default_secret: 'GROQ_API_KEY', key_available: false },
  { name: 'deepgram', stages: ['stt', 'tts'], installed: true, default_secret: 'DEEPGRAM_SERVER_KEY', key_available: false },
  { name: 'anthropic', stages: ['llm'], installed: true, default_secret: 'ANTHROPIC_API_KEY', key_available: false },
  { name: 'silero', stages: ['vad'], installed: true, default_secret: null, key_available: false },
];

// ---- the catalogue ---------------------------------------------------------------------------------------------------
test('only providers the runtime can run are offered, never the older XML names', () => {
  const offered = new Set(FALLBACK_PROVIDERS.map((p) => p.name));
  for (const gone of ['whisper', 'gpt-transcribe', 'mistral', 'microsoft phi-4']) {
    assert.ok(!offered.has(gone), `${gone} must not be offered`);
    assert.ok(!(gone in PROVIDER_LABELS), `${gone} must not have a label`);
    for (const stage of ['stt', 'llm', 'tts']) assert.ok(!(gone in MODEL_OPTIONS[stage]), `${gone} must have no models for ${stage}`);
  }
  assert.deepEqual(
    providersForStage(null, 'stt')
      .map((p) => p.name)
      .sort(),
    ['cartesia', 'deepgram', 'elevenlabs', 'openai', 'openai_compatible'],
  );
  assert.deepEqual(
    providersForStage(null, 'llm')
      .map((p) => p.name)
      .sort(),
    ['anthropic', 'openai', 'openai_compatible'],
  );
  assert.deepEqual(
    providersForStage(null, 'tts')
      .map((p) => p.name)
      .sort(),
    ['cartesia', 'deepgram', 'elevenlabs', 'openai', 'openai_compatible'],
  );
});

test('every provider the runtime can run has a label, and the ones with known models list them properly', () => {
  for (const provider of FALLBACK_PROVIDERS) assert.ok(PROVIDER_LABELS[provider.name], provider.name);
  for (const stage of ['stt', 'llm', 'tts']) {
    for (const [provider, models] of Object.entries(MODEL_OPTIONS[stage])) {
      assert.equal(new Set(models.map((x) => x.id)).size, models.length, `${stage}/${provider} repeats a model id`);
      assert.ok(
        models.every((x) => x.id && x.label && x.note),
        `${stage}/${provider} has an incomplete entry`,
      );
      assert.equal(defaultModelFor(stage, provider), models[0]?.id || '');
    }
  }
  assert.deepEqual(MODEL_OPTIONS.llm.openai_compatible, []); // its models are whatever the endpoint serves: typed in
  assert.ok(modelsFor('stt', 'openai').some((x) => x.id === 'gpt-realtime-whisper')); // the server's own agent uses it
  assert.ok(modelsFor('llm', 'anthropic').length >= 3);
});

test('the server’s list drives the picker: provider order, installed first', () => {
  const stt = providersForStage(SERVER, 'stt').map((p) => p.name);
  assert.deepEqual(stt, ['deepgram', 'openai', 'groq']); // installed ones first, alphabetical by label; groq last
  assert.deepEqual(
    providersForStage(SERVER, 'llm').map((p) => p.name),
    ['anthropic', 'openai', 'groq'],
  );
  assert.deepEqual(
    providersForStage(SERVER, 'vad').map((p) => p.name),
    ['silero'],
  );
});

test('names, labels and secret names (the server’s own name wins)', () => {
  assert.equal(providerLabel('openai_compatible'), 'OpenAI-compatible');
  assert.equal(providerLabel('some_new-provider'), 'Some New Provider');
  assert.equal(modelLabel('stt', 'openai', 'gpt-realtime-whisper'), 'GPT Realtime Whisper');
  assert.equal(modelLabel('stt', 'openai', 'custom-model'), 'custom-model');
  assert.equal(secretFor('deepgram'), 'DEEPGRAM_API_KEY');
  assert.equal(secretFor('deepgram', SERVER), 'DEEPGRAM_SERVER_KEY');
  assert.match(secretFor('azure openai'), SECRET_PATTERN);
  assert.equal(secretFor('azure openai'), 'AZURE_OPENAI_API_KEY');
  assert.equal(STAGES.length, 3);
});

// ---- reading ---------------------------------------------------------------------------------------------------------
test('reads the three stages, and an agent with none set up reads as empty', () => {
  const read = readModels(agent());
  assert.deepEqual(read.stt, { provider: 'openai', model: 'gpt-realtime-whisper', secret: 'OPENAI_API_KEY', baseUrl: '' });
  assert.deepEqual(read.tts, { provider: 'elevenlabs', model: 'eleven_flash_v2_5', secret: 'ELEVEN_API_KEY', baseUrl: '', voiceId: 'Z8dg0fyk7p6js7cQ7lgi' });
  assert.deepEqual(readModels({}).stt, { provider: '', model: '', secret: '', baseUrl: '' });
  const summary = summarizeModels(agent());
  assert.deepEqual(
    summary.map((s) => [s.label, s.providerName, s.modelName]),
    [
      ['Speech-to-text', 'OpenAI', 'GPT Realtime Whisper'],
      ['Language model', 'OpenAI', 'GPT-4.1 Mini'],
      ['Text-to-speech', 'ElevenLabs', 'Flash v2.5'],
    ],
  );
  assert.equal(summarizeModels({})[0].set, false);
});

// ---- choosing a provider then a model ------------------------------------------------------------------------------------
test('choosing a provider selects its first model and its secret, keeps what still applies, drops what does not', () => {
  const config = agent();
  const next = setProvider(config, 'stt', 'deepgram');
  assert.deepEqual(next.defaults.models.stt, { provider: 'deepgram', model: 'nova-3', language: 'en', api_key: { secret: 'DEEPGRAM_API_KEY' } }); // `options` belonged to OpenAI
  assert.equal(config.defaults.models.stt.provider, 'openai'); // the input is not modified
  assert.deepEqual(next.defaults.models.llm, config.defaults.models.llm); // other stages untouched
  assert.equal(setProvider(config, 'stt', 'deepgram', SERVER).defaults.models.stt.api_key.secret, 'DEEPGRAM_SERVER_KEY');
});

test('choosing a provider then a model: the new choice is what the agent reads back', () => {
  const start = setProvider(agent(), 'llm', 'anthropic');
  assert.equal(readModels(start).llm.provider, 'anthropic');
  assert.equal(readModels(start).llm.model, 'claude-sonnet-5-5');
  assert.equal(readModels(start).llm.secret, 'ANTHROPIC_API_KEY');
  const picked = setModel(start, 'llm', 'claude-haiku-5-5');
  assert.equal(summarizeModels(picked)[1].modelName, 'Claude Haiku 5.5');
  assert.deepEqual(start.defaults.models.llm.fallbacks, agent().defaults.models.llm.fallbacks); // fallbacks still apply
});

test('an OpenAI-compatible provider takes a base URL, which is dropped when the provider changes', () => {
  const start = setProvider(agent(), 'llm', 'openai_compatible');
  assert.equal(readModels(start).llm.model, ''); // no ready-made list: typed in
  const withUrl = setBaseUrl(setModel(start, 'llm', 'mistral-small-latest'), 'llm', ' https://api.mistral.ai/v1 ');
  assert.equal(withUrl.defaults.models.llm.base_url, 'https://api.mistral.ai/v1');
  assert.equal(readModels(withUrl).llm.baseUrl, 'https://api.mistral.ai/v1');
  assert.equal(setProvider(withUrl, 'llm', 'openai').defaults.models.llm.base_url, undefined);
  assert.equal(setBaseUrl(withUrl, 'llm', '').defaults.models.llm.base_url, undefined);
});

test('a provider the runtime doesn’t know is offered the fix, and the fix produces a runnable setting', () => {
  const old = agent();
  old.defaults.models.stt = { provider: 'whisper', model: 'large-v3', api_key: { secret: 'OPENAI_API_KEY' } };
  old.defaults.models.llm = { provider: 'microsoft phi-4', model: 'phi-4' };
  assert.equal(renamedProvider('stt', 'whisper').model, 'whisper-1');
  assert.equal(renamedProvider('llm', 'mistral').provider, 'openai_compatible');
  assert.equal(renamedProvider('stt', 'mistral'), null); // only at the stage it applies to
  assert.equal(renamedProvider('stt', 'openai'), null);
  const fixed = applyRenamedProvider(old, 'stt');
  assert.deepEqual([fixed.defaults.models.stt.provider, fixed.defaults.models.stt.model], ['openai', 'whisper-1']);
  const fixedLlm = applyRenamedProvider(old, 'llm');
  assert.equal(fixedLlm.defaults.models.llm.provider, 'openai_compatible');
  assert.equal(fixedLlm.defaults.models.llm.model, 'phi-4');
  assert.equal(fixedLlm.defaults.models.llm.base_url, undefined); // where Phi-4 is hosted is the person's to say
  const mistral = { ...agent(), defaults: { models: { ...agent().defaults.models, llm: { provider: 'mistral', model: 'mistral-large-latest' } } } };
  const fixedMistral = applyRenamedProvider(mistral, 'llm').defaults.models.llm;
  assert.deepEqual(
    [fixedMistral.provider, fixedMistral.model, fixedMistral.base_url, fixedMistral.api_key.secret],
    ['openai_compatible', 'mistral-small-latest', 'https://api.mistral.ai/v1', 'MISTRAL_API_KEY'],
  );
  assert.equal(applyRenamedProvider(agent(), 'stt').defaults.models.stt.provider, 'openai'); // nothing to fix
  assert.ok(Object.values(RENAMED_PROVIDERS).every((fix) => fix.why.length > 20));
});

test('text-to-speech: switching provider switches model, key and voice together', () => {
  const next = setProvider(agent(), 'tts', 'cartesia');
  const tts = next.defaults.models.tts;
  assert.equal(tts.provider, 'cartesia');
  assert.equal(tts.model, 'sonic-3');
  assert.deepEqual(tts.api_key, { secret: 'CARTESIA_API_KEY' });
  assert.equal(tts.voice_id, voicesFor('cartesia', 'Female')[0].voiceId); // a new provider starts on a female voice // the old voice belongs to the old provider
  assert.deepEqual(tts.text_transforms, ['filter_markdown']); // still applies
  const voiced = setVoiceId(next, voicesFor('cartesia')[2].voiceId);
  assert.equal(readModels(voiced).tts.voiceId, voicesFor('cartesia')[2].voiceId);
});

test('a saved voice becomes the real voice: its provider, that provider’s model and key, and the voice id', () => {
  const config = agent();
  const same = applyVoice(config, { provider: 'elevenlabs', name: 'Rachel', voice_id: 'rachel-id' });
  assert.equal(same.defaults.models.tts.voice_id, 'rachel-id');
  assert.equal(same.defaults.models.tts.model, 'eleven_flash_v2_5'); // same provider keeps its model
  const other = applyVoice(config, { provider: 'cartesia', name: 'Blake', voiceId: 'a167e0f3' });
  assert.equal(other.defaults.models.tts.model, 'sonic-3');
  assert.deepEqual(other.defaults.models.tts.api_key, { secret: 'CARTESIA_API_KEY' });
  assert.equal(other.defaults.models.tts.voice_id, 'a167e0f3');
  assert.equal(config.defaults.models.tts.voice_id, 'Z8dg0fyk7p6js7cQ7lgi'); // the input is not modified
});

test('an agent with no models yet gets a complete setting when a provider is chosen', () => {
  const blank = { schema_version: '1.1', meta: { id: 'x' } };
  const next = setProvider(blank, 'tts', 'elevenlabs');
  assert.deepEqual(Object.keys(next.defaults.models.tts).sort(), ['api_key', 'model', 'provider', 'voice_id']);
  assert.equal(next.defaults.models.tts.model, 'eleven_flash_v2_5');
  assert.equal(readModels(blank).tts.provider, '');
});

test('choosing what is already chosen changes nothing, and any other model id can be typed', () => {
  const config = agent();
  assert.equal(setProvider(config, 'stt', 'openai'), config);
  assert.equal(setModel(config, 'llm', 'gpt-4.1-mini'), config);
  assert.equal(setSecret(config, 'llm', 'OPENAI_API_KEY'), config);
  assert.equal(setVoiceId(config, 'Z8dg0fyk7p6js7cQ7lgi'), config);
  const typed = setModel(config, 'stt', '  my-own-model  ');
  assert.equal(typed.defaults.models.stt.model, 'my-own-model');
  assert.equal(summarizeModels(typed)[0].modelName, 'my-own-model');
  assert.equal(setModel(config, 'stt', '').defaults.models.stt.model, undefined);
});

test('the secret name can be changed or removed', () => {
  const config = agent();
  assert.deepEqual(setSecret(config, 'stt', 'BANK_OPENAI_KEY').defaults.models.stt.api_key, { secret: 'BANK_OPENAI_KEY' });
  assert.equal(setSecret(config, 'stt', '').defaults.models.stt.api_key, undefined);
});

test('two configurations are compared by their models only', () => {
  const a = agent();
  const b = agent();
  b.persona = { name: 'Someone else' };
  assert.equal(sameModels(a, b), true);
  assert.equal(sameModels(a, setModel(b, 'llm', 'gpt-4.1')), false);
});

test('voices come as Female and Male lists, and a provider starts on a female voice', async () => {
  const { VOICE_GENDERS, defaultVoiceFor, genderOfVoice } = await import('../src/studio/models/config.js');
  assert.deepEqual(VOICE_GENDERS, ['Female', 'Male']);
  for (const provider of ['elevenlabs', 'cartesia']) {
    const female = voicesFor(provider, 'Female');
    const male = voicesFor(provider, 'Male');
    assert.ok(female.length > 0 && male.length > 0, `${provider} has both`);
    assert.ok(female.every((v) => v.gender === 'Female') && male.every((v) => v.gender === 'Male'));
    assert.equal(female.length + male.length, voicesFor(provider).length, 'every voice is one or the other');
    assert.equal(defaultVoiceFor(provider).gender, 'Female');
    assert.equal(genderOfVoice(provider, male[0].voiceId), 'Male');
  }
  assert.equal(genderOfVoice('elevenlabs', 'not-a-known-voice'), 'Female');
  assert.equal(defaultVoiceFor('nobody'), undefined);
});

test('default speech models: the best provider the server can run is chosen for each missing stage, and what is set is left alone', async () => {
  const { addDefaultSpeechModels, bestProviderFor } = await import('../src/studio/models/config.js');
  const providers = [
    { name: 'openai', stages: ['stt', 'llm', 'tts'], installed: true, default_secret: 'OPENAI_API_KEY', key_available: false },
    { name: 'deepgram', stages: ['stt', 'tts'], installed: true, default_secret: 'DEEPGRAM_API_KEY', key_available: true },
    { name: 'elevenlabs', stages: ['stt', 'tts'], installed: true, default_secret: 'ELEVEN_API_KEY', key_available: false },
    { name: 'groq', stages: ['stt', 'llm', 'tts'], installed: false, default_secret: 'GROQ_API_KEY', key_available: true },
    { name: 'openai_compatible', stages: ['stt', 'llm', 'tts'], installed: true, key_available: true },
  ];
  assert.equal(bestProviderFor('stt', providers).name, 'deepgram', 'installed and its key is set');
  assert.equal(bestProviderFor('tts', providers).name, 'deepgram');
  assert.equal(
    bestProviderFor(
      'stt',
      providers.filter((p) => p.name !== 'deepgram'),
    ).name,
    'elevenlabs',
    'with no key set anywhere, an installed one still beats nothing',
  );
  assert.equal(
    bestProviderFor(
      'stt',
      providers.filter((p) => p.name === 'groq' || p.name === 'openai_compatible'),
    ),
    null,
    'not installed, or needing a base URL first: never chosen',
  );
  const config = { defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' } } } };
  const out = addDefaultSpeechModels(config, providers);
  assert.deepEqual(
    out.added.map((a) => [a.stage, a.provider, a.keySet]),
    [
      ['stt', 'deepgram', true],
      ['tts', 'deepgram', true],
    ],
  );
  assert.equal(out.config.defaults.models.stt.provider, 'deepgram');
  assert.ok(out.config.defaults.models.stt.model, 'a model comes with the provider');
  assert.ok(out.config.defaults.models.tts.model, 'and for speaking, a model');
  assert.equal(out.config.defaults.models.llm.provider, 'openai', 'the language model is untouched');
  assert.equal(config.defaults.models.stt, undefined, 'the original is not changed');
  const again = addDefaultSpeechModels(out.config, providers);
  assert.deepEqual(again.added, []);
  assert.equal(again.config, out.config, 'nothing to add: the same object comes back');
  const none = addDefaultSpeechModels(config, [{ name: 'anthropic', stages: ['llm'], installed: true }]);
  assert.deepEqual(none.skipped, ['stt', 'tts']);
  assert.equal(none.config, config);
});
