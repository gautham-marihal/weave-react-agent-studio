// What every Radix layer of the studio (menu, pop-over, tooltip, select, dialog) does the same way.

// Escape is taken by the top layer only: Radix hears it first and closes its own layer, and the key stops there,
// so a studio side panel or dialog underneath (which listens to the page) doesn't close too.
export const keepEscape = (event: KeyboardEvent): void => {
  event.stopPropagation();
};

// A menu item that opens something runs after the menu has closed and returned focus to its button, so a dialog it
// opens gives focus back there. Radix returns focus in a timer set as it closes, so the item waits two timers.
export const afterMenu = (action: (() => void) | undefined) => (): void => {
  if (action) window.setTimeout(() => window.setTimeout(action, 0), 0);
};

// A dialog opened by code (not a Radix trigger) gives focus back to what had it on opening; Radix would give it to its
// missing trigger, so to nothing. `opener` is read as the dialog is first drawn.
export const backTo =
  (opener: Element | null) =>
  (event: Event): void => {
    event.preventDefault();
    if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
  };
