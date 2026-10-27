import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, setupDom, teardownDom, textOf } from './component/dom.js';

// The search (Ctrl K): a command palette (cmdk in a Radix Dialog). What a screen reader is told, matches however they are typed, the keyboard, and
// closing it.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const key = (el, k) =>
  act(async () => {
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
const box = () => $(document.body, '.searchPanel [cmdk-input]');
const shown = () => $$(document.body, '.searchPanel [cmdk-item]').map((item) => textOf(item.querySelector('strong')));
const chosen = () => textOf($(document.body, '.searchPanel [cmdk-item][aria-selected="true"] strong'));
const mount = () => mountScreen('search', {}, { ready: '.searchPanel' });

test('the search is a named dialog with a box that lists the results and names the one the keyboard is on', async () => {
  const app = await mount();
  const dialog = box().closest('[role="dialog"]');
  assert.equal(textOf(document.getElementById(dialog.getAttribute('aria-labelledby'))), 'Search Weave');
  assert.equal(box().getAttribute('role'), 'combobox');
  assert.equal(document.getElementById(box().getAttribute('aria-controls')).getAttribute('role'), 'listbox');
  assert.deepEqual(shown(), ['Home', 'Monitoring', 'Speed', 'Help & shortcuts']);
  assert.deepEqual($$(document.body, '.searchPanel [cmdk-group-heading]').map(textOf), ['Navigate', 'Actions']);
  assert.equal(chosen(), 'Home', 'the first result is ready for Enter');
  assert.equal(textOf(document.getElementById(box().getAttribute('aria-activedescendant'))?.querySelector('strong')), 'Home', 'and a screen reader hears it');
  await app.unmount();
});

test('results are found however they are typed, the closest first', async () => {
  const app = await mount();
  const type = (text) => a.type(box(), text);
  await type('spd');
  assert.deepEqual(shown(), ['Speed'], 'letters left out');
  await type('monitring');
  assert.deepEqual(shown(), ['Monitoring'], 'a slip');
  await type('agents fast');
  assert.deepEqual(shown(), ['Speed'], 'words in any order, from the description too');
  await type('zzqx');
  assert.deepEqual(shown(), []);
  assert.match(textOf($(document.body, '.searchNoResults')), /No matches for “zzqx”/);
  await app.unmount();
});

test('the arrows move through the results across the groups and round; Enter opens one; Escape closes', async () => {
  const app = await mount();
  await key(box(), 'ArrowDown');
  assert.equal(chosen(), 'Monitoring');
  await key(box(), 'End');
  assert.equal(chosen(), 'Help & shortcuts', 'across the groups, to the last');
  await key(box(), 'ArrowDown');
  assert.equal(chosen(), 'Home', 'and round');
  await key(box(), 'ArrowUp');
  await key(box(), 'Enter');
  assert.equal(app.config.picked, 'help');
  assert.ok($(app.container, '.searchClosed'), 'choosing closes it');
  await app.unmount();

  const again = await mount();
  await key(box(), 'Escape');
  assert.ok($(again.container, '.searchClosed'), 'Escape closes it');
  assert.equal(again.config.picked, undefined, 'without choosing anything');
  await again.unmount();
});
