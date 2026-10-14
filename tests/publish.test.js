import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, currentStage, publishOptions } from '../src/studio/format.js';

test('compareVersions compares numbers, not text', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
});

test('publish options: a draft that equals the patch bump appears once, not twice', () => {
  const { options, defaultChoice } = publishOptions('1.0.0', '1.0.1');
  assert.deepEqual(options.map((o) => [o.value, o.version]), [['patch', '1.0.1'], ['minor', '1.1.0'], ['major', '2.0.0']]);
  assert.equal(options[0].matchesDraft, true);
  assert.equal(defaultChoice, 'patch');
});

test('publish options: a draft number of its own is offered first and chosen by default', () => {
  const { options, defaultChoice } = publishOptions('1.0.0', '1.5.0');
  assert.equal(options[0].value, 'draft');
  assert.equal(options[0].disabled, false);
  assert.equal(defaultChoice, 'draft');
});

test('publish options: a draft that is not newer than the latest is switched off', () => {
  for (const draft of ['1.0.0', '0.9.0']) {
    const { options, defaultChoice } = publishOptions('1.0.0', draft);
    assert.equal(options[0].value, 'draft');
    assert.equal(options[0].disabled, true);
    assert.equal(defaultChoice, 'patch');
  }
});

test('publish options: an invalid draft version is switched off too', () => {
  const { options } = publishOptions('1.0.0', undefined);
  assert.equal(options[0].disabled, true);
});

test('publish options: first publish offers just the draft version', () => {
  const { options, defaultChoice } = publishOptions(null, '0.1.0');
  assert.deepEqual(options.map((o) => o.value), ['draft']);
  assert.equal(defaultChoice, 'draft');
});

test('current stage is the furthest environment, then published, then draft', () => {
  assert.deepEqual(currentStage({ latest_version: '0.2.0', deployed: { development: '0.2.0', staging: '0.2.0', production: '0.1.0' } }), { kind: 'env', env: 'production', version: '0.1.0', also: ['staging', 'development'] });
  assert.equal(currentStage({ deployed: { development: '0.1.0' } }).env, 'development');
  assert.deepEqual(currentStage({ latest_version: '1.0.0', deployed: {} }), { kind: 'published', version: '1.0.0' });
  assert.deepEqual(currentStage({ latest_version: null }), { kind: 'draft' });
});
