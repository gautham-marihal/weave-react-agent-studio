import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, setupDom, teardownDom, textOf } from './component/dom.js';
import { ACCENTS } from '../src/studio/usePref.js';

// The style picker (Settings and the Theme menu): six styles, and under them the colour options of the style in use, as a radio group that a
// pointer or the arrow keys change, remembered for each style on its own.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const radios = (root) => $$(root, '.accentRow [role="radio"]');
const checked = (root) => radios(root).find((r) => r.getAttribute('aria-checked') === 'true');
const press = (el, key) =>
  act(async () => {
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

test('the colours of the style in use: five, its own first, one picked; a click or the arrow keys pick another, and each style keeps its own', async () => {
  localStorage.clear();
  const app = await mountScreen('stylecards', {}, { ready: '.stylePicker' });
  assert.equal($$(app.container, '.styleCard').length, 6);
  assert.deepEqual(
    radios(app.container).map((r) => r.getAttribute('aria-label')),
    ACCENTS.simple.map((o) => o.label),
  );
  assert.equal(checked(app.container).getAttribute('aria-label'), 'Black and white', 'the style’s own palette to start with');
  assert.equal($(app.container, '.accentRow').getAttribute('aria-label'), 'Colour of Simple');
  assert.equal(radios(app.container).filter((r) => r.tabIndex === 0).length, 1, 'one stop for the keyboard: the one picked');

  await a.click(radios(app.container)[2]);
  assert.equal(checked(app.container).getAttribute('aria-label'), 'Navy');
  assert.equal(localStorage.getItem('weave_accent_simple'), 'navy');
  assert.match(textOf($(app.container, '.accentHead')), /Colour\s*Navy/);

  await press(checked(app.container), 'ArrowRight');
  assert.equal(localStorage.getItem('weave_accent_simple'), 'forest', 'the arrow moves to the next');
  await press(checked(app.container), 'ArrowLeft');
  await press(checked(app.container), 'ArrowLeft');
  await press(checked(app.container), 'ArrowLeft');
  await press(checked(app.container), 'ArrowLeft');
  assert.equal(localStorage.getItem('weave_accent_simple'), 'wine', 'and goes round from the first to the last');

  // another style: its own five, its own first; coming back finds Simple as it was left
  await a.click($(app.container, '.styleCard[data-style-preview="futuristic"]'));
  assert.deepEqual(
    radios(app.container).map((r) => r.getAttribute('aria-label')),
    ACCENTS.futuristic.map((o) => o.label),
  );
  assert.equal(checked(app.container).getAttribute('aria-label'), 'Neon');
  await a.click(radios(app.container).find((r) => r.getAttribute('aria-label') === 'Synthwave'));
  await a.click($(app.container, '.styleCard[data-style-preview="simple"]'));
  assert.equal(checked(app.container).getAttribute('aria-label'), 'Wine');
  assert.equal(localStorage.getItem('weave_accent_futuristic'), 'synthwave');

  // a colour that is no longer offered falls back to the style's own
  localStorage.setItem('weave_accent_professional', 'crimson');
  await a.click($(app.container, '.styleCard[data-style-preview="professional"]'));
  assert.equal(checked(app.container).getAttribute('aria-label'), 'Blue');
  await app.unmount();
});
