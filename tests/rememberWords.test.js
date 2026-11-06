import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDetail,
  filtersOf,
  keyFor,
  readDetails,
  setKind,
  setSecret,
  setStart,
  startOf,
} from '../src/studio/agent/detailed/conversationView/rememberWords.js';

test('a name as people write it becomes a key the config can use, never one already taken', () => {
  assert.equal(keyFor('Preferred branch'), 'preferred_branch');
  assert.equal(keyFor('  Date of birth! '), 'date_of_birth');
  assert.equal(keyFor('2nd phone'), 'detail_2nd_phone');
  assert.equal(keyFor(''), 'detail');
  assert.equal(keyFor('email', ['email', 'email_2']), 'email_3');
});

test('how a detail starts, in words', () => {
  assert.equal(startOf({}).words, 'Empty');
  assert.equal(startOf({ default: 'gold' }).words, '“gold”');
  assert.equal(startOf({ default: false }).words, '“false”');
  assert.equal(startOf({ source: { channel: 'modality' } }).words, 'From the channel: voice or chat');
  assert.equal(startOf({ source: { generate: { kind: 'uuid' } } }).how, 'newId');
  assert.equal(startOf({ source: { caller_id: true } }).words, 'The caller’s number');
  assert.equal(startOf({ source: { constant: 'SG' } }).words, 'Always “SG”');
});

test('the details read in order, with kinds and filters that count them', () => {
  const config = { state: { variables: { amount: { type: 'number' }, pin: { type: 'string', sensitive: true }, ok: { type: 'boolean' } } } };
  const details = readDetails(config);
  assert.deepEqual(
    details.map((d) => [d.words, d.kind, d.secret]),
    [
      ['amount', 'Number', false],
      ['pin', 'Text', true],
      ['ok', 'Yes or no', false],
    ],
  );
  assert.deepEqual(
    filtersOf(details).map((f) => `${f.name} ${f.count}`),
    ['All 3', 'Text 1', 'Number 1', 'Yes or no 1', 'Secret 1'],
  );
});

test('adding and changing a detail writes only the schema’s own fields', () => {
  let { config, key } = addDetail({}, 'Tier', { type: 'enum', secret: true });
  assert.equal(key, 'tier');
  assert.deepEqual(config.state.variables.tier, { type: 'enum', nullable: true, default: null, values: [], sensitive: true });
  config = setStart(config, key, 'newId');
  assert.deepEqual(config.state.variables.tier.source, { generate: { kind: 'uuid' } });
  config = setStart(config, key, 'value', { value: 'gold' });
  assert.equal(config.state.variables.tier.source, undefined, 'one way of starting at a time');
  assert.equal(config.state.variables.tier.default, 'gold');
  config = setKind(config, key, 'boolean');
  assert.equal(config.state.variables.tier.values, undefined, 'only a list has choices');
  assert.equal(config.state.variables.tier.default, null, 'a value that no longer fits is dropped');
  config = setSecret(config, key, false);
  assert.equal('sensitive' in config.state.variables.tier, false);
});
