import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MISSES, afterMiss, deploymentOf, failureReason } from '../src/studio/release/deployWatch.js';
import { applyChange } from '../src/studio/pendingChange.js';
import { browserChannels, offeredChannels } from '../src/studio/form/channelTypes.js';
import { parseTemplateFile } from '../src/studio/savedTemplates.js';

// The fixes for the API guide's points (README 5): a deploy followed until it settles, the session's own channel list,
// a repeated key in an imported template, and a first save that failed being kept for review.

test('a pending deployment is asked about again after a dropped connection, but not for ever, and never after an answer that can’t change', () => {
  assert.equal(afterMiss({ kind: 'network' }, 1), 'retry');
  assert.equal(afterMiss({ kind: 'server' }, MAX_MISSES - 1), 'retry');
  assert.equal(afterMiss({ kind: 'network' }, MAX_MISSES), 'stop', '15 misses in a row (30 seconds) is enough');
  for (const kind of ['not_found', 'auth', 'invalid', 'client_bug']) assert.equal(afterMiss({ kind }, 1), 'stop', kind);
});

test('the deployment in an answer: the record itself, or under `deployment`', () => {
  const d = { id: 'd1', status: 'active' };
  assert.equal(deploymentOf(d), d);
  assert.equal(deploymentOf({ deployment: d, preflight: {} }), d);
  assert.equal(deploymentOf(null), null);
  assert.equal(deploymentOf('nope'), null);
});

test('why a deployment failed, when the server says, in any of the usual fields', () => {
  assert.equal(failureReason({ status: 'failed' }), '');
  assert.equal(failureReason({ status: 'failed', error: ' The index build ran out of time. ' }), 'The index build ran out of time.');
  assert.equal(failureReason({ status: 'failed', detail: 'No dispatch rule.' }), 'No dispatch rule.');
  assert.equal(failureReason({ status: 'failed', error: { message: 'Trunk refused.' } }), 'Trunk refused.');
  assert.equal(failureReason(null), '');
});

test('the Test panel’s channels: the server’s list, once it has answered, wins over what the config says', () => {
  const config = {
    channels: [
      { id: 'chat', type: 'web_chat', modalities: { input: ['text'], output: ['text'] } },
      { id: 'voice', type: 'web_voice', modalities: { input: ['audio'], output: ['audio'] } },
    ],
  };
  const local = browserChannels(config);
  assert.equal(offeredChannels(local, null), local, 'no answer yet: the config');
  assert.equal(offeredChannels(local, []), local, 'an empty list says nothing');
  assert.deepEqual(
    offeredChannels(local, ['voice']).map((c) => c.id),
    ['voice'],
    'a channel the server does not offer to browsers is not offered',
  );
  assert.deepEqual(
    offeredChannels(local, [{ id: 'chat' }, { id: 'web2', type: 'web_voice', input: ['audio'] }]),
    [local[0], { id: 'web2', type: 'web_voice', input: ['audio'], output: [] }],
    'objects too, in the server’s order; one the config here doesn’t have comes as the server describes it',
  );
});

test('an imported template with a key written twice is refused, like the server refuses it, rather than losing one', () => {
  const twice = '{"agents": {"items": []}, "persona": {"tone": "calm", "tone": "brisk"}}';
  const { error, template } = parseTemplateFile(twice);
  assert.equal(template, undefined);
  assert.match(error, /“tone” appears twice/);
  assert.match(parseTemplateFile('{nope').error, /^That isn’t valid JSON/);
  assert.ok(parseTemplateFile('{"agents": {"items": []}}').template);
});

test('a new agent whose first save failed keeps what it was made with, and says which: template or blank', () => {
  const config = { meta: { id: 'a' }, agents: { items: [] } };
  const made = { ...config, defaults: { language: 'en' } };
  assert.match(applyChange(config, { kind: 'template', config: made }).note, /^Your template is applied/);
  assert.match(applyChange(config, { kind: 'blank', config: made }).note, /main language is set/);
  assert.match(applyChange(config, { kind: 'assistant', config: made }).note, /from your description/);
  assert.equal(applyChange(config, { kind: 'blank', config: made }).config, made);
  assert.equal(applyChange(config, { kind: 'blank' }), null, 'nothing to apply without a config');
});

test('a passed run with live scenarios left out says they weren’t run, not “4 of 7” (UI review 2.4)', async () => {
  const { passedRunText } = await import('../src/studio/scenarios/runResults.js');
  const { testHealth } = await import('../src/studio/test/testHealth.js');
  assert.equal(passedRunText({ passed: 5, total: 5, skipped: 0 }), 'The latest run passed (5 of 5).');
  assert.equal(passedRunText({ passed: 4, total: 7, skipped: 3 }), 'The latest run passed: 4 passed, 3 not run (live).');
  const h = testHealth({ scenarioCount: 7, latestRun: { status: 'passed', passed: 4, failed: 0, errors: 0, skipped: 3, total: 7 } });
  assert.deepEqual(h.counts.scenarios, { text: '4 pass, 3 not run', tone: 'warn' });
  assert.deepEqual(h.tiles.find((t) => t.id === 'scenarios').chip, { text: '3 not run', tone: 'warn' });
});

test('a knowledge problem’s fix that is an operator’s command line is not shown on Deploy (UI review 3a)', async () => {
  const { normalizePreflightKnowledge } = await import('../src/studio/release/checklist.js');
  const rows = normalizePreflightKnowledge([
    { base: 'help', problems: [{ problem: 'No index has been built.', fix: 'python -m agent_runtime.knowledge_index build acme --base help' }] },
    { base: 'faq', problems: [{ problem: 'The file changed.', fix: 'Build the index again.' }] },
  ]);
  assert.deepEqual(
    rows.map((r) => r.fix),
    ['', 'Build the index again.'],
  );
});

test('answers read as the API guide describes them: no draft_saved_at in a summary, no one named on a save', async () => {
  const S = await import('../src/api/schemas.ts');
  assert.ok(S.BotList.safeParse([{ id: 'a', name: 'A', draft_revision: 1, latest_version: null, deployed: {} }]).success);
  assert.ok(S.Draft.safeParse({ revision: 3, saved_at: '2026-11-04T10:00:00Z', saved_by: null, config: {} }).success);
  assert.ok(!S.Draft.safeParse({ revision: 3, saved_at: '2026-11-04T10:00:00Z', config: 'nope' }).success, 'a config must still be an object');
});
