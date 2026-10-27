import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOWN, bestFirst, matchScore } from '../src/ui/match.ts';
import { searchAgent } from '../src/studio/agent/pages.js';

// The search's matching (ui/match.ts): forgiving the way people type, never finding what isn't there.
const found = (query, title, other) => matchScore(query, title, other) >= SHOWN;

test('a result is found from the start of a word, with letters left out, or with a slip in a longer word', () => {
  assert.equal(matchScore('speed', 'Speed'), 1);
  assert.ok(found('spe', 'Speed'));
  assert.ok(found('spd', 'Speed'), 'letters left out');
  assert.ok(found('monitring', 'Monitoring'), 'a letter left out of a longer word');
  assert.ok(found('scnearios', 'Scenarios'), 'two letters swapped');
  assert.ok(found('publsh acme', 'Publish a version', 'Acme Support'), 'words in any order, one from the other words');
  assert.ok(found('Café', 'cafe'), 'accents and capitals do not matter');
});

test('nothing is found that isn’t there: every word typed has to match, and a short slip is not a match', () => {
  assert.equal(matchScore('zzz', 'Speed'), 0);
  assert.equal(matchScore('speed zzz', 'Speed'), 0, 'every word');
  assert.equal(matchScore('voice', 'Settings', 'description owner tags engine keys json reliability'), 0);
  assert.ok(!found('spx', 'Speed'), 'a slip in a short word is not forgiven');
  assert.equal(matchScore('', 'Anything'), 1, 'nothing typed matches everything');
});

test('the title counts more than the other words, and the whole phrase in the title most', () => {
  assert.ok(matchScore('deploy', 'Deploy') > matchScore('deploy', 'Releases', 'publish deploy versions'));
  assert.ok(matchScore('a vers', 'Put a version live') > matchScore('vers a', 'Put a version live'), 'the words as the title has them, in its order');
  const items = [
    { t: 'Releases', o: 'deploy' },
    { t: 'Deploy now', o: '' },
    { t: 'Speed', o: '' },
  ];
  assert.deepEqual(
    bestFirst(items, 'deploy', (i) => [i.t, i.o]).map((i) => i.t),
    ['Deploy now', 'Releases'],
  );
  assert.equal(
    bestFirst(items, '', (i) => [i.t, i.o]),
    items,
    'nothing typed: all, as they were',
  );
});

test('an agent’s pages and things to do are found however they are typed, a title match still first', () => {
  const ids = (q) => searchAgent(q).map((i) => i.id);
  assert.equal(ids('roll bak')[0], 'rollback');
  assert.ok(ids('scnearios').includes('page-tests'), 'Tests holds the scenarios');
  assert.equal(ids('publsh')[0], 'publish');
  assert.ok(ids('knowlege').includes('page-knowledge'));
  assert.deepEqual(ids('zzz'), []);
});
