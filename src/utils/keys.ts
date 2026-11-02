// Key names as people see them on their own keyboard: ⌘ on a Mac, Ctrl elsewhere. Pure, apart from reading the
// browser's platform once.

/** Whether a platform string (navigator.platform or the user agent) is a Mac, iPhone or iPad. */
export function isMacPlatform(platform: string | undefined | null): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(String(platform ?? ''));
}

const browserPlatform = (): string => {
  if (typeof navigator === 'undefined') return '';
  const withData = navigator as Navigator & { userAgentData?: { platform?: string } };
  return withData.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
};

/** True when the person is on a Mac (read once, when the app starts). */
export const IS_MAC = isMacPlatform(browserPlatform());

/** The modifier key's name: "⌘" on a Mac, "Ctrl" elsewhere. */
export const modKey = (mac: boolean = IS_MAC): string => (mac ? '⌘' : 'Ctrl');

/** A shortcut with the modifier, as it reads on this keyboard: "⌘ K" or "Ctrl K". */
export const shortcutLabel = (key: string, mac: boolean = IS_MAC): string => `${modKey(mac)} ${key.toUpperCase()}`;

/** Redo: ⌘ ⇧ Z on a Mac, Ctrl Y elsewhere (both work everywhere). */
export const redoLabel = (mac: boolean = IS_MAC): string => (mac ? '⌘ ⇧ Z' : 'Ctrl Y');

/** Whether a key press happened while typing somewhere, so a single-key shortcut (like "?") must not act on it. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (!el || typeof el !== 'object' || !('tagName' in el)) return false;
  return !!el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(String(el.tagName));
}
