import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, setupDom, teardownDom, textOf } from './component/dom.js';

// The parts of a page (ui/Parts.tsx, Radix Tabs) and the one-of-several switches (ui/OneOf.tsx, Radix ToggleGroup): what a screen reader is told, and
// that the keyboard and the mouse choose the way a person expects.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const key = (el, k) =>
  act(async () => {
    el.focus();
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    // Radix moves the keyboard along a row a moment later
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
// a tab opens on the press of the mouse, as the browser's own tabs do
const press = (el) =>
  act(async () => {
    el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  });

test('a page with parts: a named row of tabs, the open one chosen, and the page under it labelled by it', async () => {
  const app = await mountScreen('pageshell', { part: 'files' }, { ready: '[role=tablist]' });
  const row = $(app.container, '[role=tablist]');
  assert.equal(row.getAttribute('aria-label'), 'Knowledge sections');
  const tabs = $$(row, '[role=tab]');
  assert.deepEqual(tabs.map(textOf), ['Documents', 'How it searches']);
  assert.deepEqual(
    tabs.map((t) => t.getAttribute('aria-selected')),
    ['true', 'false'],
  );
  assert.equal(tabs[0].className, 'on', 'the styles draw the open part from its class');
  const panel = $(app.container, '[role=tabpanel]');
  assert.equal(panel.getAttribute('aria-labelledby'), tabs[0].id);
  assert.equal(textOf(panel), 'the files part');
  await app.unmount();
});

test('a page with parts: the arrows move along the row without opening a part; Enter or a press opens one', async () => {
  const app = await mountScreen('pageshell', { part: 'files' }, { ready: '[role=tablist]' });
  const tabs = () => $$(app.container, '[role=tab]');
  await key(tabs()[0], 'ArrowRight');
  assert.equal(document.activeElement, tabs()[1], 'the keyboard is on the next part');
  assert.equal(app.config.part, 'files', 'passing over a part does not open it');
  await key(tabs()[1], 'ArrowRight');
  assert.equal(document.activeElement, tabs()[0], 'and round to the first');
  await key(tabs()[1], 'Enter');
  assert.equal(app.config.part, 'settings');
  assert.equal(textOf($(app.container, '[role=tabpanel]')), 'the settings part');
  assert.equal(tabs()[1].getAttribute('tabindex'), '0', 'the row is one Tab stop, on the open part');
  await press(tabs()[0]);
  assert.equal(app.config.part, 'files');
  await app.unmount();
});

test('one of several: a named group of choices with the chosen one on; a click chooses, and pressing the chosen one keeps it', async () => {
  const app = await mountScreen('oneof', { view: 'trace' }, { ready: '[role=radiogroup]' });
  const group = $(app.container, '[role=radiogroup]');
  assert.equal(group.getAttribute('aria-label'), 'How to read this call');
  const choices = () => $$(group, '[role=radio]');
  assert.deepEqual(choices().map(textOf), ['What happened', 'Conversation only', 'Replay']);
  assert.deepEqual(
    choices().map((c) => c.getAttribute('aria-checked')),
    ['true', 'false', 'false'],
  );
  assert.equal(choices()[0].className, 'on');
  await a.click(choices()[1]);
  assert.equal(app.config.view, 'conversation');
  assert.equal(choices()[1].className, 'on');
  await a.click(choices()[1]);
  assert.equal(app.config.view, 'conversation', 'the chosen one stays chosen');
  assert.equal(choices()[2].disabled, true);
  await key(choices()[1], 'ArrowRight');
  assert.equal(document.activeElement, choices()[0], 'the arrows skip a choice that cannot be made, and go round');
  await app.unmount();
});
