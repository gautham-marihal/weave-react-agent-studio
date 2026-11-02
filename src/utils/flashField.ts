import { flash } from './focusField';

/**
 * Flashes a setting and puts the cursor in its own control (its `…-input`), not in a button beside its name such as
 * Reset. Falls back to the first box or choice inside it.
 */
export function flashField(el: HTMLElement): void {
  flash(el);
  const own = el.id ? document.getElementById(`${el.id}-input`) : null;
  const control = own ?? el.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select, [role="switch"]');
  control?.focus({ preventScroll: true });
}
