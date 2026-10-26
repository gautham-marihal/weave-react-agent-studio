import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, teardownDom } from './component/dom.js';

// The keyboard of the small menus that are not the "⋯" Menu (the profile menu): the arrows, Home and End go round the items, skipping a disabled one;
// Tab closes the menu.
await setupDom();
after(() => teardownDom());
const { menuKeyDown } = await import('../src/ui/menuKeys.js');

const menu = () => {
  const box = document.createElement('div');
  box.innerHTML = '<button role="menuitem">Account</button><button role="menuitem" disabled>Billing</button><button role="menuitem">Sign out</button>';
  document.body.append(box);
  return box;
};
const press = (box, key, onClose = () => {}) => {
  const event = new window.KeyboardEvent('keydown', { key, cancelable: true });
  menuKeyDown(event, box, onClose);
  return event;
};

test('the arrows go round the menu, past a disabled item', () => {
  const box = menu();
  const [account, , signOut] = box.querySelectorAll('button');
  account.focus();
  assert.equal(press(box, 'ArrowDown').defaultPrevented, true);
  assert.equal(document.activeElement, signOut, 'the disabled item is skipped');
  press(box, 'ArrowDown');
  assert.equal(document.activeElement, account, 'and it wraps round');
  press(box, 'ArrowUp');
  assert.equal(document.activeElement, signOut);
  press(box, 'Home');
  assert.equal(document.activeElement, account);
  press(box, 'End');
  assert.equal(document.activeElement, signOut);
  box.remove();
});

test('Tab closes it; other keys are left alone', () => {
  const box = menu();
  let closed = 0;
  assert.equal(press(box, 'Tab', () => (closed += 1)).defaultPrevented, false, 'Tab still moves on');
  assert.equal(closed, 1);
  assert.equal(press(box, 'a').defaultPrevented, false);
  box.remove();
});
