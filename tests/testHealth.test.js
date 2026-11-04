import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testHealth } from '../src/studio/test/testHealth.js';

// "Ready to publish?" (src/studio/test/testHealth.js): one verdict and a tile per kind of test, from what the Test stage
// knows; and the short result each part shows in the views row.
const run = (passed, failed, total, extra = {}) => ({
  status: failed ? 'failed' : 'passed',
  passed,
  failed,
  errors: 0,
  skipped: 0,
  total,
  startedAt: '2026-11-01T10:00:00Z',
  ...extra,
});

test('nothing tested yet: it says so, and each tile says how to start', () => {
  const h = testHealth({});
  assert.equal(h.verdict.ok, false);
  assert.equal(h.verdict.title, 'Nothing tested yet');
  assert.deepEqual(
    h.tiles.map((t) => t.id),
    ['scenarios', 'callers', 'checks'],
  );
  assert.ok(h.tiles.every((t) => t.note));
  assert.deepEqual(h.counts, {});
});

test('a failing scenario run: the verdict names how many fail, the tile counts them, and Scenarios says “2 fail”', () => {
  const h = testHealth({ scenarioCount: 10, latestRun: run(8, 2, 10) });
  assert.equal(h.verdict.title, 'Not yet: 2 scenarios fail');
  const tile = h.tiles.find((t) => t.id === 'scenarios');
  assert.equal(tile.big, '8');
  assert.equal(tile.of, 'of 10 passed');
  assert.deepEqual(tile.chip, { text: '2 fail', tone: 'bad' });
  assert.equal(tile.bars.filter((b) => b === 'fail').length, 2);
  assert.deepEqual(h.counts.scenarios, { text: '2 fail', tone: 'bad' });
});

test('callers needing a look and a readiness check to fix are named, and counted in the views row', () => {
  const h = testHealth({
    scenarioCount: 3,
    latestRun: run(3, 0, 3),
    callers: { passed: 4, attention: 2, total: 6, names: ['Frustrated', 'Asks something unrelated'] },
    readiness: { passed: 11, total: 12, results: [{ name: 'Caller goes quiet', passed: false }] },
  });
  assert.equal(h.verdict.title, 'Nearly: 2 callers need a look');
  assert.match(h.tiles.find((t) => t.id === 'callers').note, /Frustrated and Asks something unrelated need a look/);
  assert.equal(h.tiles.find((t) => t.id === 'checks').note, 'To look at: Caller goes quiet');
  assert.deepEqual(h.counts.callers, { text: '2 need a look', tone: 'warn' });
  assert.deepEqual(h.counts.checks, { text: '11 of 12', tone: 'warn' });
  assert.deepEqual(h.counts.scenarios, { text: '3 of 3', tone: 'good' });
});

test('with the gate on, the verdict is the gate’s: held until the latest run passed on this draft', () => {
  const held = testHealth({ scenarioCount: 2, latestRun: run(1, 1, 2), gate: { enabled: true } });
  assert.equal(held.verdict.ok, false);
  assert.equal(held.verdict.title, 'Not yet: publishing is held');
  assert.match(held.verdict.detail, /latest run failed/);
  const dirty = testHealth({ scenarioCount: 2, latestRun: run(2, 0, 2), gate: { enabled: true }, dirty: true });
  assert.match(dirty.verdict.detail, /changes the last run did not see/);
  const ok = testHealth({ scenarioCount: 2, latestRun: run(2, 0, 2), gate: { enabled: true }, savedAt: '2026-11-01T09:00:00Z' });
  assert.equal(ok.verdict.ok, true);
});
