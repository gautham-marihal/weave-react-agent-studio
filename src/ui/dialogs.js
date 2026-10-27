// Decisions in the studio's own dialog, not the browser's confirm()/alert(), which look foreign and freeze the page.
// askConfirm() resolves true or false; showNotice() resolves on close; one <DialogHost /> (App.jsx) draws them.
// With no host (a component test) the browser's box is used, so a decision is never silently skipped.
//   tone: 'danger' for something that can't be undone (red button, focus on Cancel), else 'default'

let current = null;
let made = 0;
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener(current));

export function subscribeDialogs(listener) {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

function open(dialog) {
  return new Promise((resolve) => {
    // a second request replaces the first, which counts as declined
    if (current) current.resolve(false);
    made += 1;
    current = {
      ...dialog,
      id: made,
      resolve: (value) => {
        current = null;
        emit();
        resolve(value);
      },
    };
    emit();
  });
}

const plain = ({ title, body }) => [title, body].filter(Boolean).join('\n\n');

export function askConfirm({ title, body = '', confirmLabel = 'Continue', cancelLabel = 'Cancel', tone = 'default' }) {
  if (!listeners.size) return Promise.resolve(typeof window !== 'undefined' && window.confirm ? window.confirm(plain({ title, body })) : false);
  return open({ kind: 'confirm', title, body, confirmLabel, cancelLabel, tone });
}

export function showNotice({ title, body = '', closeLabel = 'OK' }) {
  if (!listeners.size) {
    if (typeof window !== 'undefined' && window.alert) window.alert(plain({ title, body }));
    return Promise.resolve(true);
  }
  return open({ kind: 'notice', title, body, confirmLabel: closeLabel, tone: 'default' });
}
