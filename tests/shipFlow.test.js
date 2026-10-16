import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shipSteps } from '../src/studio/release/shipFlow.js';

const ok = {
  dirty: false,
  report: { errors: [] },
  scenarioCount: 2,
  latestRun: { status: 'passed', passed: 2, total: 2 },
  published: { version: '0.1.1', changes: 0 },
  deployed: { staging: '0.1.1' },
};
const by = (r, id) => r.steps.find((s) => s.id === id);

test('everything done: ready, nothing next', () => {
  const r = shipSteps(ok);
  assert.equal(r.ready, true);
  assert.equal(r.done, 5);
  assert.equal(r.next, null);
});

test('unsaved edits come first', () => {
  const r = shipSteps({ ...ok, dirty: true });
  assert.equal(by(r, 'save').state, 'todo');
  assert.equal(r.next.id, 'save');
  assert.equal(r.ready, false);
});

test('an unreadable configuration blocks, and blocked outranks to-do', () => {
  const r = shipSteps({ ...ok, parseError: 'bad', dirty: true, published: null });
  assert.equal(r.next.id, 'save');
  assert.equal(by(r, 'save').state, 'blocked');
});

test('validation errors block with a count', () => {
  const r = shipSteps({ ...ok, report: { errors: [{}, {}] } });
  assert.equal(by(r, 'valid').state, 'blocked');
  assert.match(by(r, 'valid').text, /2 errors/);
});

test('no scenarios is optional, never a blocker, and not counted', () => {
  const r = shipSteps({ ...ok, scenarioCount: 0, latestRun: null });
  assert.equal(by(r, 'tested').state, 'optional');
  assert.equal(r.total, 4);
  assert.equal(r.ready, true);
});

test('a failing latest run blocks', () => {
  const r = shipSteps({ ...ok, latestRun: { status: 'failed', passed: 1, total: 2 } });
  assert.equal(by(r, 'tested').state, 'blocked');
  assert.equal(r.next.id, 'tested');
});

test('changes since the published version ask for a publish', () => {
  const r = shipSteps({ ...ok, published: { version: '0.1.1', changes: 3 } });
  assert.equal(by(r, 'published').state, 'todo');
  assert.ok(r.next.action.publish);
  assert.match(by(r, 'published').text, /3 changes/);
});

test('nothing published yet: publish, then deploy waits', () => {
  const r = shipSteps({ ...ok, published: null, deployed: {} });
  assert.equal(by(r, 'published').state, 'todo');
  assert.match(by(r, 'deployed').text, /Publish first/);
  assert.equal(by(r, 'deployed').action, undefined);
});

test('an older version running is not the newest being deployed', () => {
  const r = shipSteps({ ...ok, deployed: { development: '0.1.0' } });
  assert.equal(by(r, 'deployed').state, 'todo');
  assert.match(by(r, 'deployed').text, /older version/);
  assert.equal(r.next.action.tab, 'deploy');
});
