import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, setupDom, teardownDom, textOf } from './component/dom.js';
import { filterOptions, normalizeOptions } from '../src/studio/selectOptions.js';

// The shared selector: a short list is the browser's own <select>; a long one is a searchable combobox that works from the keyboard and says
// what it is to a screen reader (WAI-ARIA combobox: role, aria-expanded, aria-controls, aria-activedescendant, listbox, options).
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const many = Array.from({ length: 30 }, (_, i) => ({
  value: `tool_${i}`,
  label: `Tool ${i}`,
  description: i % 2 ? 'Looks things up' : 'Changes something',
  group: i < 10 ? 'Lookups' : 'Actions',
}));
const key = (el, k) =>
  act(async () => {
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
const mount = (props, picked) => mountScreen('smartselect', { picked }, { ready: '[aria-label="Pick one"]', props });
const input = (app) => $(app.container, '[aria-label="Pick one"][role=combobox]');
const optionTexts = () => $$(document, '[role=option]').map((o) => textOf(o).replace(/ ✓$/, ''));

test('SmartSelect: eight or fewer choices are a plain select, more are a searchable combobox', async () => {
  const few = await mount({ options: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }, 'b');
  assert.equal($(few.container, 'select[aria-label="Pick one"]').value, 'b');
  assert.equal($(few.container, '[role=combobox]'), null);
  await a.choose($(few.container, 'select'), 'd');
  assert.equal(few.config.picked, 'd');
  await few.unmount();
  const lots = await mount({ options: many }, 'tool_3');
  assert.equal(input(lots).getAttribute('role'), 'combobox');
  assert.equal(input(lots).value, 'Tool 3', 'it shows the choice in words');
  assert.equal(input(lots).getAttribute('aria-expanded'), 'false');
  await lots.unmount();
});

test('SmartSelect: opening shows the choices with their descriptions and group headings, typing narrows them, and a choice is picked', async () => {
  const app = await mount({ options: many }, '');
  const box = input(app);
  await act(async () => {
    box.focus();
    box.click();
  });
  assert.equal(box.getAttribute('aria-expanded'), 'true');
  assert.equal(box.getAttribute('aria-controls'), $(document, '[role=listbox]').id, 'it names its list');
  assert.equal($(document, '[role=listbox]').getAttribute('aria-label'), 'Pick one');
  assert.equal(optionTexts().length, 30);
  assert.deepEqual($$(document, '.stComboGroup').map(textOf), ['Lookups', 'Actions']);
  assert.match(textOf($(document, '[role=option]')), /Tool 0Changes something/, 'a description under each');
  await a.type(box, 'tool 1 looks');
  const names = optionTexts().map((t) => t.replace(/(Looks things up|Changes something)$/, ''));
  assert.deepEqual(
    names,
    ['Tool 1', 'Tool 11', 'Tool 13', 'Tool 15', 'Tool 17', 'Tool 19', 'Tool 21'],
    'every word, anywhere, in any order: the odd ones (“looks things up”) with a 1 in them',
  );
  await a.type(box, 'zzzz');
  assert.match(textOf($(document, '[role=status]')), /Nothing matches “zzzz”/);
  await a.type(box, 'tool 27');
  await act(async () => {
    $(document, '[role=option]').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  assert.equal(app.config.picked, 'tool_27');
  assert.equal(box.getAttribute('aria-expanded'), 'false', 'it closes after a choice');
  await app.unmount();
});

test('SmartSelect: arrows move through the choices (skipping disabled ones), Enter picks, Escape closes without changing, Tab leaves', async () => {
  const options = [...many.slice(0, 11)];
  options[1] = { ...options[1], disabled: true };
  const app = await mount({ options }, 'tool_5');
  const box = input(app);
  await act(async () => {
    box.focus();
    box.click();
  });
  const active = () => $(document, `#${box.getAttribute('aria-activedescendant')}`);
  assert.match(textOf(active()), /^Tool 0/, 'the first usable choice is highlighted');
  await key(box, 'ArrowDown');
  assert.match(textOf(active()), /^Tool 2/, 'the disabled one is skipped');
  assert.equal($$(document, '[aria-disabled="true"]').length, 1);
  await key(box, 'End');
  assert.match(textOf(active()), /^Tool 10/);
  await key(box, 'ArrowDown');
  assert.match(textOf(active()), /^Tool 0/, 'it wraps round');
  await key(box, 'ArrowUp');
  assert.match(textOf(active()), /^Tool 10/);
  await key(box, 'Home');
  assert.match(textOf(active()), /^Tool 0/);
  await key(box, 'ArrowDown');
  await key(box, 'ArrowDown');
  await key(box, 'Enter');
  assert.equal(app.config.picked, 'tool_3');
  // Escape closes and leaves the choice as it was
  await act(async () => {
    box.focus();
    box.click();
  });
  await a.type(box, 'tool 8');
  await key(box, 'Escape');
  assert.equal(box.getAttribute('aria-expanded'), 'false');
  assert.equal(box.value, 'Tool 3');
  assert.equal(app.config.picked, 'tool_3');
  // arrow down on a closed list opens it
  await key(box, 'ArrowDown');
  assert.equal(box.getAttribute('aria-expanded'), 'true');
  await key(box, 'Tab');
  assert.equal(box.getAttribute('aria-expanded'), 'false');
  await app.unmount();
});

test('SmartSelect: an "add" control goes back to its prompt after each choice, and a value that is no longer in the list is still shown', async () => {
  const add = await mount({ options: many, action: true, placeholder: '＋ Add a tool…' }, '');
  assert.equal(input(add).value, '', 'it shows its prompt, not a choice');
  assert.equal(input(add).getAttribute('placeholder'), '＋ Add a tool…');
  await a.choose(input(add), 'tool_4');
  assert.equal(add.config.picked, 'tool_4');
  assert.equal(input(add).value, '', 'and is ready for the next one');
  await add.unmount();
  const gone = await mount({ options: many }, 'deleted_tool');
  assert.equal(input(gone).value, 'deleted_tool', 'a value nobody offers is not silently blanked');
  await gone.unmount();
});

test('SmartSelect: a very long list shows the first 200 and says to keep typing', async () => {
  const huge = Array.from({ length: 500 }, (_, i) => ({ value: `v${i}`, label: `Agent number ${i}` }));
  const app = await mount({ options: huge }, '');
  await act(async () => {
    input(app).focus();
    input(app).click();
  });
  assert.equal($$(document, '[role=option]').length, 200);
  assert.match(textOf($$(document, '[role=status]').pop()), /300 more: keep typing to narrow the list/);
  await a.type(input(app), 'number 49');
  assert.equal($$(document, '[role=option]').length, 15, 'typing narrows it: 49, 149, 249, 349, 449 and 490 to 499');
  await app.unmount();
});

test('the matching and the option shapes are plain functions: every word, anywhere, ignoring case', () => {
  const options = normalizeOptions(['a', 7, { value: 'x', label: 'Ex', description: 'the letter', group: 'Letters' }, { value: 'y' }]);
  assert.deepEqual(
    options.map((o) => [o.value, o.label]),
    [
      ['a', 'a'],
      ['7', '7'],
      ['x', 'Ex'],
      ['y', 'y'],
    ],
  );
  assert.deepEqual(
    filterOptions(options, 'LETTER ex').map((o) => o.value),
    ['x'],
    'label, description and group are all searched',
  );
  assert.equal(filterOptions(options, '').length, 4);
  assert.equal(filterOptions(options, 'nope').length, 0);
  assert.deepEqual(normalizeOptions(undefined), []);
});
