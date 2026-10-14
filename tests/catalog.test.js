import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE_REVIEWED, FALLBACK_PROVIDERS, MODEL_OPTIONS, PROVIDER_STAGES, catalogueProblems, catalogueSize, defaultModelFor, modelStatus, modelsFor, providersForStage } from '../src/studio/models/catalog.js';

test('the catalogue is consistent: no provider listed for a stage it can’t do, nothing missing, no duplicates', () => {
  assert.deepEqual(catalogueProblems(), []);
  assert.match(CATALOGUE_REVIEWED, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(catalogueSize() >= 40, `only ${catalogueSize()} models`);
});

test('every provider the server image ships has a model list for each stage it serves (free-text providers may be empty)', () => {
  FALLBACK_PROVIDERS.filter((p) => p.name !== 'silero').forEach((provider) => {
    provider.stages.filter((stage) => ['stt', 'llm', 'tts'].includes(stage)).forEach((stage) => {
      if (provider.name === 'openai_compatible') { assert.equal(modelsFor(stage, provider.name).length, 0); return; }
      assert.ok(modelsFor(stage, provider.name).length > 0, `${provider.name}/${stage} has models`);
    });
  });
});

test('a default model comes with every provider that has a list, and is in that list', () => {
  Object.entries(MODEL_OPTIONS).forEach(([stage, byProvider]) => Object.entries(byProvider).forEach(([provider, models]) => {
    if (!models.length) { assert.equal(defaultModelFor(stage, provider), ''); return; }
    assert.ok(models.some((model) => model.id === defaultModelFor(stage, provider)));
  }));
});

test('a model is listed, typed by someone, from a provider with no list, or not chosen', () => {
  assert.equal(modelStatus('llm', 'openai', 'gpt-4.1').state, 'listed');
  assert.match(modelStatus('llm', 'openai', 'gpt-4.1').text, /GPT-4\.1/);
  const custom = modelStatus('llm', 'openai', 'gpt-9-ultra');
  assert.equal(custom.state, 'custom');
  assert.match(custom.text, /isn’t in the catalogue/);
  assert.match(custom.text, /doesn’t check model ids/);
  assert.equal(modelStatus('llm', 'openai_compatible', 'mistral-small-latest').state, 'free');
  assert.equal(modelStatus('tts', 'google', 'anything').state, 'free', 'a provider with an empty list');
  assert.equal(modelStatus('llm', 'openai', '').state, 'empty');
});

test('the providers offered for a stage are the server’s, installed first, and the catalogue agrees with them', () => {
  const offered = providersForStage(FALLBACK_PROVIDERS, 'llm').map((p) => p.name);
  assert.deepEqual(offered, ['anthropic', 'openai', 'openai_compatible']);
  offered.forEach((name) => assert.ok(PROVIDER_STAGES[name].includes('llm')));
  const server = [{ name: 'groq', stages: ['llm'], installed: false }, { name: 'openai', stages: ['llm'], installed: true }];
  assert.deepEqual(providersForStage(server, 'llm').map((p) => p.name), ['openai', 'groq'], 'one that isn’t installed goes last');
});
