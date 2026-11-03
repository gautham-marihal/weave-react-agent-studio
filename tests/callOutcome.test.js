import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTCOMES, channelIcon, lengthOf, outcomeOf, peekOf, rowOf, summaryOf } from '../src/studio/calls/callModel.js';

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

test('a call row: its channel icon, its length with the replies, and what its record adds (first words, failed tools)', () => {
  assert.equal(channelIcon({ type: 'sip_voice' }), 'phone');
  assert.equal(channelIcon({ type: 'web_chat' }), 'chat');
  assert.equal(channelIcon({}), 'globe');
  assert.equal(lengthOf({ duration_s: 102, agent_turns: 6 }), `${rowOf({ duration_s: 102 }).duration} · 6 replies`);
  assert.match(lengthOf({ duration_s: 10, agent_turns: 1 }), /· 1 reply$/);
  const facts = {
    turns: [
      { say: '' },
      { say: ' Where is my order? ', tools: [{ tool: 'look_up', error: 'HTTP 503' }, { tool: 'end_call' }] },
      { say: 'thanks', tools: [{ error: 'x' }] },
    ],
  };
  assert.deepEqual(peekOf(facts), { first: 'Where is my order?', failed: 2 });
  assert.deepEqual(peekOf({}), { first: '', failed: 0 });
});

test('the line over the calls: how many and how they went; failed tools only once every record is read', () => {
  const rows = [
    rowOf({ id: 'a', bot: 'x', status: 'ended' }),
    rowOf({ id: 'b', bot: 'x', status: 'ended', handoffs: 1 }),
    rowOf({ id: 'c', bot: 'x', status: 'unfinished' }),
    rowOf({ id: 'd', bot: 'x', status: 'in_progress' }),
  ];
  assert.equal(summaryOf(rows), '4 calls · 1 handled · 1 passed to a person · 1 cut off · 1 in progress');
  const some = { 'x/a': { first: '', failed: 1 } };
  assert.doesNotMatch(summaryOf(rows, some), /failed/, 'not while records are still being read');
  const all = { ...some, 'x/b': { first: '', failed: 0 }, 'x/c': { first: '', failed: 2 } };
  assert.match(summaryOf(rows, all), /· 2 with a failed tool$/);
  assert.equal(summaryOf([]), '');
});
