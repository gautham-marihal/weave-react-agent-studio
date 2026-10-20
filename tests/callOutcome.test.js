import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTCOMES, outcomeOf, rowOf } from '../src/studio/calls/callModel.js';

// How a call went, in a word for the lists: handled by the agent, passed to a person, cut off, or still going.

test('a call’s outcome comes from its status and its hand-overs', () => {
  assert.equal(outcomeOf({ status: 'ended', handoffs: 0 }), 'handled');
  assert.equal(outcomeOf({ status: 'ended' }), 'handled');
  assert.equal(outcomeOf({ status: 'ended', handoffs: 2 }), 'handoff');
  assert.equal(outcomeOf({ status: 'unfinished', handoffs: 1 }), 'cutoff', 'cut off wins over a hand-over');
  assert.equal(outcomeOf({ status: 'in_progress' }), 'progress');
  assert.equal(outcomeOf({ status: 'odd' }), '');
  assert.equal(outcomeOf(null), '');
});

test('each outcome filters the API on a status it knows, and the row says it in words', () => {
  assert.deepEqual(
    Object.values(OUTCOMES).map((o) => o.status),
    ['ended', 'ended', 'unfinished', 'in_progress'],
  );
  const row = rowOf({ id: 'c1', bot: 'a', status: 'ended', handoffs: 3 }, 'Acme');
  assert.deepEqual([row.outcome, row.outcomeLabel, row.outcomeTone], ['handoff', 'Passed to a person', 'info']);
  assert.match(row.outcomeHint, /3 times/);
  const odd = rowOf({ id: 'c2', bot: 'a', status: 'odd' });
  assert.equal(odd.outcomeLabel, 'odd', 'a status the studio does not know is shown as it is');
});
