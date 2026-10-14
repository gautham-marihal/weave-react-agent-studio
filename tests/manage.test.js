import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCENARIOS, hasHumanHandoff, runScenarioChecks } from '../src/studio/scenarios.js';
import { applyChange, queueChange, takeChange } from '../src/studio/pendingChange.js';
import { toLegacyAgent } from '../src/studio/agents.js';
import { configToText, exportFileName } from '../src/studio/manage/exportConfig.js';

const example = JSON.parse(readFileSync(new URL('./fixtures/agent-config.example.json', import.meta.url), 'utf8'));
// What the server creates for a new agent: a web chat and one assistant, nothing else.
const starter = {
  schema_version: '1.1',
  meta: { id: 'x', name: 'X', version: '0.1.0', status: 'draft' },
  runtime: { engine: 'livekit-agents', provider_mode: 'plugins' },
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' } }, conversation: {} },
  persona: { name: 'X' },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, modalities: { input: ['text'], output: ['text'] }, greeting: { say: 'Hello!' } }],
  agents: { entry: 'assistant', items: [{ id: 'assistant', name: 'X', kind: 'standalone', instructions: { role: 'Help.' }, tools: [] }] },
};

test('a fully configured agent passes all twelve simulation scenarios, each with a reason', () => {
  const results = runScenarioChecks(example);
  assert.equal(results.length, SCENARIOS.length);
  assert.equal(results.length, 12);
  assert.deepEqual(results.filter((r) => !r.passed).map((r) => r.id), []);
  assert.ok(results.every((r) => r.detail.length > 5));
});

test('the starter agent passes only what it actually has, and says what is missing', () => {
  const results = runScenarioChecks(starter);
  const passed = results.filter((r) => r.passed).map((r) => r.id).sort();
  assert.deepEqual(passed, ['chat', 'goal', 'greet']);
  assert.match(results.find((r) => r.id === 'person').detail, /No transfer/);
});

test('scenario checks cope with missing or broken configs', () => {
  assert.ok(runScenarioChecks(null).every((r) => !r.passed && /couldn’t be read/.test(r.detail)));
  assert.doesNotThrow(() => runScenarioChecks({ channels: 'nope', tools: 7, agents: null }));
  assert.equal(runScenarioChecks(example, 3).length, 3);
});

test('handoff is found through a tool, a transfer or an escalation rule', () => {
  assert.equal(hasHumanHandoff(example), true);
  assert.equal(hasHumanHandoff(starter), false);
  assert.equal(hasHumanHandoff({ ...starter, telephony: { transfers: [{ id: 't', method: 'sip_refer' }] } }), true);
  assert.equal(hasHumanHandoff({ ...starter, guardrails: { escalation: [{ id: 'e', action: 'tool', tool: 'x' }] } }), true);
  assert.equal(hasHumanHandoff(undefined), false);
});

test('a voice is put on the draft without disturbing anything else', () => {
  const change = { kind: 'voice', provider: 'elevenlabs', providerLabel: 'ElevenLabs', name: 'Rachel', voiceId: 'abc123' };
  const result = applyChange(starter, change);
  assert.deepEqual(result.config.defaults.models.tts, { provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice_id: 'abc123' });
  assert.deepEqual(result.config.defaults.models.llm, starter.defaults.models.llm);
  assert.deepEqual(result.where, ['defaults', 'models', 'tts']);
  assert.match(result.note, /Rachel/);
  assert.equal(starter.defaults.models.tts, undefined, 'the original config is not modified');
  // same provider keeps the model and options that were chosen
  const again = applyChange(result.config, { ...change, voiceId: 'zzz' });
  assert.equal(again.config.defaults.models.tts.model, 'eleven_multilingual_v2');
  assert.equal(again.config.defaults.models.tts.voice_id, 'zzz');
  // another provider gets that provider's own default model
  assert.equal(applyChange(result.config, { ...change, provider: 'cartesia', providerLabel: 'Cartesia' }).config.defaults.models.tts.model, 'sonic-3');
});

test('a connection is added under a unique, valid id', () => {
  const change = { kind: 'connection', name: 'My CRM (Prod)', url: 'https://crm.example.test' };
  const first = applyChange(starter, change);
  assert.deepEqual(first.config.connections, { my_crm_prod: { type: 'http', base_url: 'https://crm.example.test', timeout_s: 10 } });
  const second = applyChange(first.config, change);
  assert.deepEqual(Object.keys(second.config.connections), ['my_crm_prod', 'my_crm_prod_2']);
  assert.ok(Object.keys(second.config.connections).every((id) => /^[a-z][a-z0-9_-]{0,63}$/.test(id)));
  assert.equal(applyChange(starter, { kind: 'nope' }), null);
  assert.equal(applyChange(null, change), null);
});

test('a queued change is handed over once, and only to the agent it was for', () => {
  const store = new Map();
  globalThis.window = { sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) } };
  try {
    queueChange('agent-a', { kind: 'voice', name: 'Rachel' });
    assert.equal(takeChange('agent-b'), null);
    assert.equal(takeChange('agent-a').name, 'Rachel');
    assert.equal(takeChange('agent-a'), null);
  } finally {
    delete globalThis.window;
  }
});

test('API agents are mapped for the older pages by where they run', () => {
  const base = { id: 'a', name: 'A', draft_revision: 1, draft_saved_at: '2026-01-01T00:00:00Z' };
  assert.deepEqual([toLegacyAgent(base).status, toLegacyAgent(base).environment, toLegacyAgent(base).versions], ['draft', 'development', []]);
  const staged = toLegacyAgent({ ...base, latest_version: '0.2.0', deployed: { staging: '0.2.0' } });
  assert.deepEqual([staged.status, staged.environment, staged.version, staged.versions.length], ['staging', 'staging', '0.2.0', 1]);
  assert.equal(toLegacyAgent({ ...base, latest_version: '1.0.0', deployed: { staging: '1.0.0', production: '1.0.0' } }).status, 'published');
  assert.equal(toLegacyAgent({ id: 'only-id' }).name, 'only-id');
});

test('exported files are named safely and are readable JSON', () => {
  assert.equal(exportFileName('ui-dev-sandbox', 'draft'), 'ui-dev-sandbox-draft.json');
  assert.equal(exportFileName('a', '0.2.0'), 'a-0.2.0.json');
  assert.equal(exportFileName('a', 'my draft/v2?'), 'a-my-draft-v2-.json');
  const text = configToText(starter);
  assert.ok(text.endsWith('\n'));
  assert.deepEqual(JSON.parse(text), starter);
});
