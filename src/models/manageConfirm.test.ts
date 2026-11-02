import { afterEach, describe, expect, it, vi } from 'vitest';
import { askConfirm, showNotice, subscribeDialogs, type ConfirmRequest } from './manageConfirm';

// Ported from Weave React dialogs.test: Studio asks in its own dialog (ConfirmHost draws it); where no host is on the
// page, the browser's box asks, so a decision is never skipped. (Leaving with unsaved edits is Studio's LeaveGuard.)

function host(answer: boolean | ((r: ConfirmRequest) => boolean)) {
  const asked: ConfirmRequest[] = [];
  const stop = subscribeDialogs((request) => {
    if (!request) return;
    asked.push(request);
    queueMicrotask(() => request.resolve(typeof answer === 'function' ? answer(request) : answer));
  });
  return { asked, stop };
}

describe('asking before something that can’t be undone', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('with no host, the browser’s box asks, with the title and the words together', async () => {
    const seen: string[] = [];
    vi.stubGlobal('window', { confirm: (text: string) => (seen.push(text), true), alert: (text: string) => void seen.push(text) });
    expect(await askConfirm({ title: 'Delete it?', body: 'It can’t be undone.' })).toBe(true);
    await showNotice({ title: 'Needs an address' });
    expect(seen).toEqual(['Delete it?\n\nIt can’t be undone.', 'Needs an address']);
  });

  it('with a host, the answer is the host’s, and the dialog says what was asked', async () => {
    const h = host(false);
    try {
      expect(await askConfirm({ title: 'Release?', body: 'Calls stop.', confirmLabel: 'Release', tone: 'danger' })).toBe(false);
      expect(h.asked).toHaveLength(1);
      expect(h.asked[0].kind).toBe('confirm');
      expect(h.asked[0].confirmLabel).toBe('Release');
      expect(h.asked[0].tone).toBe('danger');
      await showNotice({ title: 'Saved' });
      expect(h.asked[1].kind).toBe('notice');
    } finally {
      h.stop();
    }
  });

  it('a second question replaces the first, which counts as declined', async () => {
    const opened: ConfirmRequest[] = [];
    const stop = subscribeDialogs((request) => {
      if (request) opened.push(request);
    });
    try {
      const first = askConfirm({ title: 'First?' });
      const second = askConfirm({ title: 'Second?' });
      expect(await first).toBe(false);
      opened[opened.length - 1].resolve(true);
      expect(await second).toBe(true);
    } finally {
      stop();
    }
  });
});
