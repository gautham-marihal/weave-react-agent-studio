// What a page that broke while drawing says. Pure.

// A page whose files are gone (a newer Studio was released while the tab was open) can't be drawn again by a retry:
// only a reload helps.
const STALE = /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i;

export const isStaleBuild = (error: unknown): boolean =>
  STALE.test(error instanceof Error ? error.message : String(error ?? ''));

/** Whether a broken page should be drawn again: only when the person went somewhere else (the key changed). */
export const shouldResetBoundary = (hasError: boolean, previousKey: unknown, nextKey: unknown): boolean =>
  hasError && previousKey !== nextKey;

/** The text a person can copy for support: the error, where it happened and when. */
export function supportDetails(error: unknown, where: string, at: Date): string {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  return `${name}: ${message}\n${where}\n${at.toISOString()}`;
}
