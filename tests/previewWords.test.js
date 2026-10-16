import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeBlocks, modelLines, onEnterLines, stateLines } from '../src/studio/form/previewWords.js';

// The prompt preview's looser parts, in words, whatever shape the server sends: shown, never dropped, never guessed.
test('what runs when an agent takes over reads each action, and nothing means nothing', () => {
  assert.deepEqual(onEnterLines(undefined), []);
  assert.deepEqual(onEnterLines([]), []);
  const lines = onEnterLines([{ type: 'say', text: 'Hello again' }, 'something written']);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Hello again/);
  assert.equal(lines[1], 'something written');
});

test('knowledge: an array, an object of lists, an object of facts and a plain text all show, and null shows nothing', () => {
  assert.deepEqual(knowledgeBlocks(null), []);
  assert.deepEqual(knowledgeBlocks([]), []);
  assert.deepEqual(knowledgeBlocks(['faq']), [{ heading: 'Knowledge searched', items: ['faq'] }]);
  const blocks = knowledgeBlocks({ before_each_reply: [{ base: 'faq', top_k: 3 }], tools: [{ tool: 'search_help', base: 'faq' }], note: 'built nightly' });
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].heading, 'Searched before every reply');
  assert.match(blocks[0].items[0], /^faq \(top k 3\)$/);
  assert.equal(blocks[1].heading, 'Searched when the model asks');
  assert.equal(blocks[1].items[0], 'search_help (base faq)');
  assert.deepEqual(blocks[2], { heading: 'Note', items: ['built nightly'] });
  assert.deepEqual(knowledgeBlocks({ bases: [] }), [], 'an empty list says nothing');
});

test('models: each stage says its provider, model and the NAME of the secret, fallbacks follow, and a list of layers reads too', () => {
  const lines = modelLines({
    llm: {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      api_key: { secret: 'OPENAI_API_KEY' },
      temperature: 0.3,
      fallbacks: [{ provider: 'anthropic', model: 'claude-sonnet-5-5' }],
    },
    stt: { provider: 'deepgram', model: 'nova-3' },
    tts: null,
  });
  assert.deepEqual(
    lines.map((l) => l.label),
    ['Thinking', 'Listening'],
  );
  assert.match(lines[0].text, /openai gpt-4\.1-mini/);
  assert.match(lines[0].text, /temperature 0\.3/);
  assert.match(lines[0].text, /uses the secret OPENAI_API_KEY/);
  assert.match(lines[0].text, /then anthropic claude-sonnet-5-5/);
  assert.equal(modelLines(null).length, 0);
  const layered = modelLines([
    { layer: 'defaults', llm: { provider: 'openai', model: 'a' } },
    { layer: 'agent', llm: { provider: 'openai', model: 'b' } },
  ]);
  assert.deepEqual(
    layered.map((l) => l.label),
    ['Defaults', 'Agent'],
  );
  assert.match(layered[1].text, /Thinking: openai b/);
});

test('state: values are listed, sensitive ones stay masked and are marked, unset is said', () => {
  assert.deepEqual(stateLines(null), []);
  const lines = stateLines({ verified: true, pin: '•••', name: null, intent: 'billing' });
  assert.deepEqual(
    lines.map((l) => [l.name, l.text, l.masked]),
    [
      ['verified', 'true', false],
      ['pin', '•••', true],
      ['name', 'not set', false],
      ['intent', 'billing', false],
    ],
  );
});
