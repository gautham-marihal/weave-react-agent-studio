import test from 'node:test';
import assert from 'node:assert/strict';
import { guardrailActions, limitsSentence, normalizeGuardrails } from '../src/studio/form/tryPanels.js';
import { normalizeResultPreview, taskWords } from '../src/studio/form/serverPreview.js';
import { refreshNote, settingsOf } from '../src/studio/knowledge/model.js';
import { FALLBACK_TURN_DETECTORS, providerLabel, providerOptionNote } from '../src/studio/models/catalog.js';
import { modelStageOf } from '../src/studio/form/modelFields.js';

// What a second reading of FRONTEND_GUIDE 4, README 4 and UI_REVIEW 4 found the studio was not yet doing (2026-10-22).

test('the guardrails preview: how each action works, with the line it says by default, and the limits in force with their goodbye (10.1)', () => {
  const view = normalizeGuardrails({
    matched: [],
    how_actions_work: { deflect: 'A fixed line is said and the model is not asked.', block: 'The line is dropped.' },
    default_lines: { deflect: 'Sorry, I can’t help with that.', end_call: 'I have to end this call. Goodbye.' },
    limits: { max_call_duration_s: 600, max_tool_calls_per_call: 20, say: 'Sorry, we have to stop here.' },
  });
  assert.deepEqual(
    guardrailActions(view).map((a) => [a.action, a.label, a.line]),
    [
      ['deflect', 'Politely decline', 'Sorry, I can’t help with that.'],
      ['block', 'Block it', ''],
      ['end_call', 'End the call', 'I have to end this call. Goodbye.'],
    ],
    'in the order of how strongly they act; an action with only a default line is still listed',
  );
  assert.equal(
    limitsSentence(view.limits),
    'Limits in force: a call ends after 10 minutes on the line or at tool call 21. Before it ends the agent says “Sorry, we have to stop here.”',
  );
  assert.equal(
    limitsSentence({ max_handoffs_per_call: 3, say: { message: 'limit_bye' } }),
    'Limits in force: a call ends at move 4 to another agent. Before it ends the agent says the message “limit_bye”.',
  );
  assert.equal(limitsSentence({}), '', 'nothing set, nothing to say');
  assert.deepEqual(guardrailActions(normalizeGuardrails({})), []);
});

test('a task tool’s “Try it” says which task it starts, its steps, and whether it would run now (10.1)', () => {
  const runs = normalizeResultPreview({ task: { id: 'verify_identity', steps: [{ id: 'ask_dob' }, { id: 'check' }], would_run: true } });
  assert.equal(taskWords(runs.task), 'Starts the task “verify_identity” (2 steps: ask_dob, check). It would run now.');
  const done = normalizeResultPreview({ task: { id: 'verify_identity', step_ids: ['ask_dob'], skipped_now: true } });
  assert.equal(taskWords(done.task), 'Starts the task “verify_identity” (1 step: ask_dob). It would not run now, because it is already done.');
  assert.equal(normalizeResultPreview({ request: { method: 'GET' } }).task, null, 'an ordinary tool has no task');
  assert.equal(taskWords(null), '');
});

test('a knowledge base set to rebuild on a timer is told the server does not do that yet (8, 10.2)', () => {
  const config = {
    knowledge: [
      { id: 'help', type: 'vector_store', refresh: 'daily' },
      { id: 'faq', type: 'vector_store' },
    ],
  };
  assert.equal(settingsOf(config, 'help').refresh, 'daily');
  assert.equal(settingsOf(config, 'faq').refresh, 'manual', 'not set means rebuilt by hand');
  assert.match(refreshNote('daily'), /set to rebuild every day, but the server doesn’t rebuild indexes on a timer yet/);
  assert.equal(refreshNote('manual'), '');
});

test('model pickers follow GET /providers: realtime only where the runtime can run it, voice-activity detection and the turn detector too (3)', () => {
  const google = {
    name: 'google',
    stages: ['llm', 'realtime'],
    installed: true,
    realtime_runnable: false,
    default_secret: 'GOOGLE_API_KEY',
    key_available: true,
  };
  assert.match(providerOptionNote(google, 'realtime'), /can’t run its realtime model yet/);
  assert.equal(providerOptionNote(google, 'llm'), 'google', 'as a language model it is fine: only its technical name is said');
  assert.match(providerOptionNote({ ...google, installed: false }, 'realtime'), /^google · not installed on this server$/, 'not installed says that, not both');
  assert.match(providerOptionNote({ ...google, key_available: false }, 'llm'), /no key set on the server/);
  assert.equal(modelStageOf(['defaults', 'models', 'vad', 'provider']), 'vad');
  assert.equal(modelStageOf(['defaults', 'models', 'turn_detector', 'provider']), 'turn_detector');
  assert.deepEqual(FALLBACK_TURN_DETECTORS, ['livekit-multilingual', 'livekit-english'], 'the live server’s list on 2026-10-22');
  assert.equal(providerLabel('livekit-multilingual'), 'LiveKit multilingual');
});
