import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, actions, setupDom, teardownDom } from './component/dom.js';

// The number box (form/fields.jsx NumberInput) keeps what is typed while it is typed, even when the value it gives comes
// back changed: a guardrail limit of 0 means "no limit", so typing the "0" of "0.5" stores nothing for a moment.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

// it already holds a limit, which is typed over (as a person selects it and types)
const mount = () => mountScreen('numberinput', { n: 3 }, { ready: 'input' });

test('NumberInput: typing 0.5 keeps the 0 while the stored value is briefly empty', async () => {
  const app = await mount();
  const box = $(app.container, 'input');
  await a.type(box, '0');
  assert.equal(box.value, '0', 'the 0 stays while typing');
  assert.equal(app.config.n, undefined, '0 was stored as not set');
  await a.type(box, '0.');
  await a.type(box, '0.5');
  assert.equal(box.value, '0.5');
  assert.equal(app.config.n, 0.5);
  await app.unmount();
});

test('NumberInput: leaving the box shows what was stored', async () => {
  const app = await mount();
  const box = $(app.container, 'input');
  await a.type(box, '0');
  await act(async () => {
    box.dispatchEvent(new box.ownerDocument.defaultView.FocusEvent('focusout', { bubbles: true }));
    box.dispatchEvent(new box.ownerDocument.defaultView.FocusEvent('blur'));
  });
  assert.equal(box.value, '', 'a 0 that means "not set" shows as empty once you move on');
  await app.unmount();
});
