import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, actions, setupDom, teardownDom, textOf } from './component/dom.js';

// The free value box (form/fields.jsx FreeValue): typed JSON is applied as a value, except JSON with a key written twice, which is held back with the
// reason (applying it would silently lose one of the two). An object that merely has a key called "repeated" is an ordinary value.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const mount = () => mountScreen('freevalue', { v: '' }, { ready: '[aria-label="Value"]' });
const box = (app) => $(app.container, '[aria-label="Value"]');
const problem = (app) => $(app.container, '.stFErr');

test('FreeValue: JSON is applied as a value', async () => {
  const app = await mount();
  await a.type(box(app), '{"limit": 5}');
  assert.deepEqual(app.config.v, { limit: 5 });
  assert.equal(problem(app), null);
  await app.unmount();
});

test('FreeValue: a key written twice is not applied, and the reason is said', async () => {
  const app = await mount();
  await a.type(box(app), '{"limit": 5, "limit": 9}');
  assert.equal(app.config.v, '', 'nothing was applied');
  assert.match(textOf(problem(app)), /^Not applied: .*appears twice/);
  await app.unmount();
});

test('FreeValue: an object with a key called "repeated" is applied like any other', async () => {
  const app = await mount();
  await a.type(box(app), '{"repeated": "x"}');
  assert.deepEqual(app.config.v, { repeated: 'x' });
  assert.equal(problem(app), null);
  await app.unmount();
});
