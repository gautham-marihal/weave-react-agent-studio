import { useEffect } from 'react';

// The keyboard of a small menu (as the "⋯" menus have it, studio/manage/Menu.jsx): its first item has the focus when it opens; the arrows, Home and
// End move between the items; Tab leaves it, closing it. Escape is the menu's own to handle (it closes, and gives the focus back to its button).
//   ref: the box with the role="menuitem" buttons   open: whether it is shown
const ITEMS = '[role="menuitem"]:not(:disabled)';

export function useMenuFocus(ref, open) {
  useEffect(() => {
    if (open) ref.current?.querySelector(ITEMS)?.focus({ preventScroll: true });
  }, [open, ref]);
}

export function menuKeyDown(event, box, onClose) {
  if (!box) return;
  const items = [...box.querySelectorAll(ITEMS)];
  const at = items.indexOf(document.activeElement);
  const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
  if (to !== undefined && items.length) {
    event.preventDefault();
    items[(to + items.length) % items.length].focus();
  }
  if (event.key === 'Tab') onClose();
}
