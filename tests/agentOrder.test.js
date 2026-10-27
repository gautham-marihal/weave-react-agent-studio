import test from 'node:test';
import assert from 'node:assert/strict';
import { OWN_ORDER, arrange, moveInOrder } from '../src/studio/agentOrder.js';

// The Agents list as the person arranges it (src/studio/agentOrder.js): pinned first whatever the sort, and their own order, moved one agent at a
// time without a pinned agent ever going below one that isn't.
const bots = [
  { id: 'bravo', name: 'Bravo', draft_saved_at: '2026-10-03' },
  { id: 'alpha', name: 'Alpha', draft_saved_at: '2026-10-01' },
  { id: 'delta', name: 'Delta', draft_saved_at: '2026-10-04' },
  { id: 'charlie', name: 'Charlie', draft_saved_at: '2026-10-02' },
];
const idsOf = (list) => list.map((bot) => bot.id);

test('pinned agents come first in every sort, each group in the sort chosen', () => {
  assert.deepEqual(idsOf(arrange(bots, { sort: 'name', pinned: ['delta'] })), ['delta', 'alpha', 'bravo', 'charlie']);
  assert.deepEqual(idsOf(arrange(bots, { sort: 'recent', pinned: ['alpha', 'charlie'] })), ['charlie', 'alpha', 'delta', 'bravo']);
});

test('the own order: placed agents as placed, any not placed yet after them by name', () => {
  assert.deepEqual(idsOf(arrange(bots, { sort: OWN_ORDER, order: ['delta', 'bravo'] })), ['delta', 'bravo', 'alpha', 'charlie']);
  assert.deepEqual(idsOf(arrange(bots, { sort: OWN_ORDER, order: [], pinned: ['charlie'] })), ['charlie', 'alpha', 'bravo', 'delta']);
});

test('a move puts the agent where the other one was, keeps every other agent, and stays inside its group', () => {
  const all = arrange(bots, { sort: OWN_ORDER, order: ['alpha', 'bravo', 'charlie', 'delta'], pinned: ['alpha'] });
  assert.deepEqual(moveInOrder(all, ['alpha'], 'delta', 'bravo'), ['alpha', 'delta', 'bravo', 'charlie']);
  assert.equal(moveInOrder(all, ['alpha'], 'bravo', 'alpha'), null, 'not above a pinned one');
  assert.equal(moveInOrder(all, ['alpha'], 'bravo', 'bravo'), null, 'nowhere to go');
  assert.equal(moveInOrder(all, ['alpha'], 'nobody', 'bravo'), null);
});
