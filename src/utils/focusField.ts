import type { Path } from '../types/studio';
import { fieldId } from './path';

/** Scrolls to a field, focuses its control and rings it for a moment. `nearest` scrolls only as far as needed (inside a panel). */
export function flash(el: HTMLElement, block: ScrollLogicalPosition = 'center') {
  el.scrollIntoView({ behavior: 'smooth', block });
  el.querySelector<HTMLElement>('input, textarea, select, button')?.focus({ preventScroll: true });
  el.classList.add('ring-2', 'ring-accent/40', 'ring-offset-4');
  window.setTimeout(() => el.classList.remove('ring-2', 'ring-accent/40', 'ring-offset-4'), 1800);
}

/** Flashes the field for a path, or the nearest one above it (down to `minLength` segments). False when none is on the page. */
export function highlight(path: Path, minLength: number, block: ScrollLogicalPosition = 'center'): boolean {
  for (let len = path.length; len >= minLength && len > 0; len--) {
    const el = document.getElementById(fieldId(path.slice(0, len)));
    if (el) {
      flash(el, block);
      return true;
    }
  }
  return false;
}
