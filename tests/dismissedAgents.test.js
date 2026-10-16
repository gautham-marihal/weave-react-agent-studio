import test from 'node:test';
import assert from 'node:assert/strict';

// The store reads this browser's storage when it loads, so the storage has to exist first.
const store = new Map([
  ['weave_hidden_agents', JSON.stringify(['a', 'b'])],
  ['weave_dismissed_agents', JSON.stringify(['old', 7])],
]);
globalThis.window = { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } };
const { dismissBot, undoDismissed, hideBot, restoreBot } = await import('../src/studio/agents.js');

test('deleting from the removed list is remembered in this browser, once per agent, and keeps what was already deleted', () => {
  dismissBot('a');
  dismissBot('a');
  assert.deepEqual(JSON.parse(store.get('weave_dismissed_agents')), ['old', 'a'], 'the saved list is read (ignoring junk) and added to, without repeats');
  assert.deepEqual(JSON.parse(store.get('weave_hidden_agents')), ['a', 'b'], 'the agent stays removed: deleting never brings it back into the main list');
});

test('“Bring them back” undoes every delete and returns the agents to the removed list (still hidden, not shown)', () => {
  undoDismissed();
  assert.deepEqual(JSON.parse(store.get('weave_dismissed_agents')), []);
  assert.deepEqual(JSON.parse(store.get('weave_hidden_agents')), ['a', 'b']);
});

test('restoring and removing still work beside it', () => {
  restoreBot('a');
  hideBot('c');
  assert.deepEqual(JSON.parse(store.get('weave_hidden_agents')), ['b', 'c']);
});

test('bringing back deleted agents can be limited to the ones the page shows', () => {
  dismissBot('x');
  dismissBot('y');
  dismissBot('z');
  undoDismissed(['x', 'z']);
  assert.deepEqual(
    JSON.parse(store.get('weave_dismissed_agents')).filter((id) => ['x', 'y', 'z'].includes(id)),
    ['y'],
  );
  undoDismissed();
  assert.deepEqual(JSON.parse(store.get('weave_dismissed_agents')), []);
});
