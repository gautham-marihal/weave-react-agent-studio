import { useEffect, useState } from 'react';

// The keyboard stays with an open dialog: focus moves into it when it opens (unless something in it already has it, such as a field with
// autoFocus), Tab and Shift+Tab go round its controls instead of wandering to the page behind, and focus goes back where it was when it closes.
//   ref: the dialog's box   initial: what gets the focus first (an element, or a function returning one); the box itself when not given
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapTab(event, box) {
  if (event.key !== 'Tab' || !box) return;
  const items = [...box.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  if (!items.length) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !box.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !box.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export function useDialogFocus(ref, initial) {
  // what had the keyboard before the dialog opened, read as it is first drawn: a field in it with autoFocus has taken
  // the focus by the time effects run
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));
  useEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const before = opener && !box.contains(opener) ? opener : document.activeElement;
    if (!box.contains(document.activeElement)) {
      const target = (typeof initial === 'function' ? initial() : initial) || box;
      target.focus?.({ preventScroll: true });
    }
    const onKey = (event) => trapTab(event, box);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (before && before !== document.body && document.contains(before)) before.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening: the dialog's box is the same for as long as it is open
  }, []);
}
