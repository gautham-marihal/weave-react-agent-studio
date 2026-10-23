import test from 'node:test';
import assert from 'node:assert/strict';
import { edgesOf } from '../src/ui/scrollEdges.js';
import { placeDrop } from '../src/ui/dropPlace.js';

// A scroll area says which of its edges have more past them, so that edge fades instead of slicing a line.
test('a scroll area marks the edges it has more past', () => {
  assert.equal(edgesOf({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 }), '', 'all of it shows');
  assert.equal(edgesOf({ scrollTop: 0, scrollHeight: 900, clientHeight: 300 }), 'bottom', 'at the top of a long list');
  assert.equal(edgesOf({ scrollTop: 200, scrollHeight: 900, clientHeight: 300 }), 'top bottom', 'in the middle');
  assert.equal(edgesOf({ scrollTop: 600, scrollHeight: 900, clientHeight: 300 }), 'top', 'at the end');
  assert.equal(edgesOf({ scrollTop: 0.5, scrollHeight: 301, clientHeight: 300 }), '', 'a pixel of rounding is nothing');
});

// A list that drops from a field opens where it fits, no taller than the room on that side.
test('a list opens under its field when it fits, else on the side with more room', () => {
  const window = { top: 56, bottom: 650 };
  // plenty of room under the field
  assert.deepEqual(placeDrop({ top: 120, bottom: 160 }, window, 300), { up: false, room: 476 });
  // near the bottom: more room above, so it opens upward, as tall as fits there
  assert.deepEqual(placeDrop({ top: 480, bottom: 520 }, window, 300), { up: true, room: 410 });
  // too tall for either side: the bigger side, and it scrolls inside
  assert.deepEqual(placeDrop({ top: 330, bottom: 370 }, window, 900), { up: false, room: 266 });
  // it fits below even though there is more room above: below
  assert.deepEqual(placeDrop({ top: 480, bottom: 520 }, window, 100), { up: false, room: 116 });
  // no room at all is never negative
  assert.equal(placeDrop({ top: 640, bottom: 680 }, window, 200).room >= 0, true);
});
