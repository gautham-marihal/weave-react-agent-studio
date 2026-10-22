import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askConfirm, showNotice, subscribeDialogs } from '../src/ui/dialogs.js';
import { setLeaveGuard, whenLeaveConfirmed } from '../src/studio/route.js';

// The studio asks in its own dialog (ui/DialogHost.jsx draws it); where no host is on the page, the browser's box is used, so a decision is never
// skipped. Leaving a page with unsaved work asks once, and only when something would be lost.

// a host that answers every dialog the way the test says, and remembers what it was asked
function host(answer) {
  const asked = [];
  const stop = subscribeDialogs((dialog) => {
    if (!dialog) return;
    asked.push(dialog);
    queueMicrotask(() => dialog.resolve(typeof answer === 'function' ? answer(dialog) : answer));
  });
  return { asked, stop };
}

test('with no host, the browser’s box asks, with the title and the words together', async () => {
  const seen = [];
  globalThis.window = { confirm: (text) => (seen.push(text), true), alert: (text) => seen.push(text) };
  try {
    assert.equal(await askConfirm({ title: 'Delete it?', body: 'It can’t be undone.' }), true);
    await showNotice({ title: 'Needs an address' });
    assert.deepEqual(seen, ['Delete it?\n\nIt can’t be undone.', 'Needs an address']);
  } finally {
    delete globalThis.window;
  }
});

test('with a host, the answer is the host’s, and the dialog says what was asked', async () => {
  const h = host(false);
  try {
    assert.equal(await askConfirm({ title: 'Leave?', body: 'Edits are lost.', confirmLabel: 'Leave', tone: 'danger' }), false);
    assert.equal(h.asked.length, 1);
    assert.equal(h.asked[0].kind, 'confirm');
    assert.equal(h.asked[0].confirmLabel, 'Leave');
    assert.equal(h.asked[0].tone, 'danger');
    await showNotice({ title: 'Saved' });
    assert.equal(h.asked[1].kind, 'notice', 'a notice is its own kind (one button), and resolves when it is closed');
  } finally {
    h.stop();
  }
});

test('a second question replaces the first, which counts as declined', async () => {
  const opened = [];
  const stop = subscribeDialogs((dialog) => dialog && opened.push(dialog));
  try {
    const first = askConfirm({ title: 'First?' });
    const second = askConfirm({ title: 'Second?' });
    assert.equal(await first, false);
    opened[opened.length - 1].resolve(true);
    assert.equal(await second, true);
  } finally {
    stop();
  }
});

test('leaving: nothing to lose goes at once; something to lose asks once, and Stay keeps you there', async () => {
  const h = host((dialog) => dialog.confirmLabel === 'Leave' && h.agree);
  try {
    let went = 0;
    setLeaveGuard(null);
    whenLeaveConfirmed(() => (went += 1));
    assert.equal(went, 1, 'no guard: no question');
    assert.equal(h.asked.length, 0);

    setLeaveGuard(() => 'Your unsaved edits will be lost.');
    h.agree = false;
    whenLeaveConfirmed(() => (went += 1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(went, 1, 'Stay: nothing happens');
    assert.equal(h.asked[0].body, 'Your unsaved edits will be lost.');

    h.agree = true;
    // what the agreed move does next (here: another guarded move) is not asked again
    whenLeaveConfirmed(() => {
      went += 1;
      whenLeaveConfirmed(() => (went += 10));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(went, 12, 'Leave: it goes, and the move inside it is not asked again');
    assert.equal(h.asked.length, 2, 'asked once for that move');
  } finally {
    setLeaveGuard(null);
    h.stop();
  }
});
