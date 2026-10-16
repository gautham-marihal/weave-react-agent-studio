import test from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_BUDGET, cardsThatMayOpen, sizeOf } from '../src/studio/form/cardSize.js';

// A card of a list opens by itself only while the screen stays small (UI review 2.5): the rule looks at how big the cards are, not only at how many there are.
test('a card is as big as the plain values in it; a list of plain values is one chip list; anything nested counts its parts', () => {
  assert.equal(sizeOf('x'), 1);
  assert.equal(sizeOf({ id: 'a', ask: 'b' }), 2);
  assert.equal(sizeOf({ id: 'a', tags: ['x', 'y', 'z'] }), 2, 'a list of plain values is one input');
  assert.equal(sizeOf({ id: 'a', skip_if: { state: 's', not_equals: null }, validate: { type: 'tool', tool: 't' } }), 5);
  assert.equal(
    sizeOf({
      steps: [
        { id: 'a', ask: 'b' },
        { id: 'c', ask: 'd' },
      ],
    }),
    4,
    'items of a list are added up',
  );
  assert.equal(sizeOf({}), 0);
});

test('the first card may always open; later ones only while the total stays within the budget', () => {
  const card = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, 'v']));
  assert.equal(OPEN_BUDGET, 24);
  assert.deepEqual(cardsThatMayOpen([card(40)]), [true], 'one big card: it is what is on the screen, so it opens');
  assert.deepEqual(cardsThatMayOpen([card(10), card(10), card(10)]), [true, true, false], 'the third would take it past 24');
  assert.deepEqual(cardsThatMayOpen([card(30), card(2), card(2)]), [true, false, false], 'once past the budget, later cards stay shut, however small');
  assert.deepEqual(cardsThatMayOpen([card(3), card(3), card(3)]), [true, true, true], 'small cards all open, as before');
  assert.deepEqual(cardsThatMayOpen([]), []);
});
