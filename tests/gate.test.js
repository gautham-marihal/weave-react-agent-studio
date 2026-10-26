import test from 'node:test';
import assert from 'node:assert/strict';
import { gateCheck } from '../src/studio/release/gateCheck.js';
import { shipSteps } from '../src/studio/release/shipFlow.js';

// "Tests must pass before publishing": held until the newest run passed and nothing changed after it.
const passed = { status: 'passed', passed: 5, total: 5, startedAt: '2026-10-16T10:00:00Z' };

test('with the gate off nothing is held, whatever the tests say', () => {
  assert.deepEqual(gateCheck({ enabled: false, scenarioCount: 0, latestRun: null }), { ok: true, why: '', action: '' });
  assert.equal(gateCheck({ enabled: false, latestRun: { status: 'failed' } }).ok, true);
});

test('with the gate on, no tests, no run, a failed run and a broken run each hold it, and say what to do', () => {
  const none = gateCheck({ enabled: true, scenarioCount: 0 });
  assert.equal(none.ok, false);
  assert.equal(none.action, 'callers');
  assert.match(none.why, /no tests yet/);
  assert.deepEqual(
    [gateCheck({ enabled: true, scenarioCount: 3 }).ok, gateCheck({ enabled: true, scenarioCount: 3 }).why],
    [false, 'The tests have not been run yet.'],
  );
  assert.match(gateCheck({ enabled: true, scenarioCount: 3, latestRun: { status: 'failed', passed: 2, total: 3 } }).why, /failed \(2 of 3 passed\)/);
  assert.match(gateCheck({ enabled: true, scenarioCount: 3, latestRun: { status: 'error' } }).why, /broke/);
  assert.match(gateCheck({ enabled: true, scenarioCount: 3, latestRun: { status: 'skipped' } }).why, /skipped everything/);
});

test('a passing run lets it through, until the draft changes after it', () => {
  const ok = gateCheck({ enabled: true, scenarioCount: 5, latestRun: passed, savedAt: '2026-10-16T09:00:00Z', dirty: false });
  assert.deepEqual([ok.ok, ok.why], [true, 'The latest run passed (5 of 5).']);
  assert.match(gateCheck({ enabled: true, scenarioCount: 5, latestRun: passed, savedAt: '2026-10-16T11:00:00Z' }).why, /saved after the last run/);
  assert.match(
    gateCheck({ enabled: true, scenarioCount: 5, latestRun: passed, savedAt: '2026-10-16T09:00:00Z', dirty: true }).why,
    /changes the last run did not see/,
  );
  assert.equal(
    gateCheck({ enabled: true, scenarioCount: 5, latestRun: passed, savedAt: '2026-10-16T10:00:00.400Z' }).ok,
    true,
    'a save in the same second as the run is not "after" it',
  );
});

test('a passing run of only some of the scenarios does not let it through, nor count as tested', () => {
  const one = { status: 'passed', passed: 1, total: 1, startedAt: '2026-10-16T10:00:00Z' };
  const held = gateCheck({ enabled: true, scenarioCount: 4, latestRun: one, savedAt: '2026-10-16T09:00:00Z' });
  assert.deepEqual([held.ok, held.why, held.action], [false, 'The latest run covered only 1 of the 4 scenarios. Run them all.', 'scenarios']);
  const step = shipSteps({ dirty: false, report: { errors: [] }, scenarioCount: 4, latestRun: one, published: null }).steps.find((s) => s.id === 'tested');
  assert.deepEqual([step.state, step.text], ['todo', 'The latest run covered only 1 of the 4 scenarios.']);
  // a run that does not say how many it covered is taken as it says
  assert.equal(gateCheck({ enabled: true, scenarioCount: 4, latestRun: { status: 'passed', total: 0 } }).ok, true);
});

test('on the way to live, the tested step is blocked by the gate, and is as before when the gate is off', () => {
  const base = { dirty: false, report: { errors: [] }, scenarioCount: 0, latestRun: null, published: null };
  const off = shipSteps(base).steps.find((s) => s.id === 'tested');
  assert.equal(off.state, 'optional', 'without the gate no tests is only optional');
  const on = shipSteps({ ...base, gate: { enabled: true, savedAt: '' } }).steps.find((s) => s.id === 'tested');
  assert.equal(on.state, 'blocked');
  assert.deepEqual(on.action, { label: 'Add tests', tab: 'callers' });
  const run = shipSteps({ ...base, scenarioCount: 4, latestRun: { status: 'failed', passed: 3, total: 4 }, gate: { enabled: true } }).steps.find(
    (s) => s.id === 'tested',
  );
  assert.deepEqual([run.state, run.action.tab], ['blocked', 'scenarios']);
  const good = shipSteps({
    ...base,
    scenarioCount: 4,
    latestRun: { status: 'passed', passed: 4, total: 4, startedAt: '2026-10-16T10:00:00Z' },
    gate: { enabled: true, savedAt: '2026-10-16T09:00:00Z' },
  }).steps.find((s) => s.id === 'tested');
  assert.equal(good.state, 'done');
});
