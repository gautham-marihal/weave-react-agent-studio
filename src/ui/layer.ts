// What every Radix layer of the studio (menu, pop-over, tooltip, select, dialog) does the same way.

// Escape is taken by the top layer only: Radix hears it first (on the page, before anything else) and closes its own
// layer, and the key stops there, so a side panel or dialog underneath (the studio's own, which listens to the page
// too) does not close with it.
export const keepEscape = (event: KeyboardEvent): void => {
  event.stopPropagation();
};

// An item of a menu that opens something (a dialog, a panel, another page): it runs once the menu has closed and given
// the keyboard back to its button, so a dialog it opens takes the keyboard from the button, and gives it back there
// when it closes. Radix gives the keyboard back a moment after the menu closes (in a timer of its own, set as it
// closes), so the item waits for that one first: a timer, then another.
export const afterMenu = (action: (() => void) | undefined) => (): void => {
  if (action) window.setTimeout(() => window.setTimeout(action, 0), 0);
};

// A dialog opened by the studio's code (not by a Radix trigger button) gives the keyboard back to what had it when it
// opened: Radix would give it to its own trigger, which there isn't, and so to nothing. `opener` is read as the dialog
// is first drawn.
export const backTo =
  (opener: Element | null) =>
  (event: Event): void => {
    event.preventDefault();
    if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
  };
