import test from 'node:test';
import assert from 'node:assert/strict';
import { modelStageOf } from '../src/studio/form/modelFields.js';

test('only the provider and the model of a speech, language or voice setting get a list; their fallbacks too', () => {
  assert.equal(modelStageOf(['defaults', 'models', 'llm', 'provider']), 'llm');
  assert.equal(modelStageOf(['defaults', 'models', 'stt', 'model']), 'stt');
  assert.equal(modelStageOf(['defaults', 'models', 'tts', 'fallbacks', 0, 'provider']), 'tts');
  assert.equal(modelStageOf(['agents', 'items', 2, 'models', 'llm', 'model']), 'llm');
  assert.equal(modelStageOf(['defaults', 'models', 'llm', 'temperature']), null);
  assert.equal(modelStageOf(['knowledge', 0, 'embedding', 'model']), null, 'a setting called model elsewhere is left alone');
  assert.equal(modelStageOf(['connections', 0, 'provider']), null);
});
