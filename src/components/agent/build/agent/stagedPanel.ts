// The open side panel of the Agent page with changes waiting for Done, so whatever would replace it (the search
// palette opening another place) asks first instead of dropping them. One at a time, since a panel covers the page.
// Plain state, no React: the panel marks itself, and anything about to replace it calls whenPanelKept.

export interface StagedPanel {
  title: string;
  doneLabel?: string;
  /** Puts the panel's changes into the draft and closes it. */
  done: () => void;
  /** Gives the keyboard back to the panel (after "Stay"). */
  refocus?: () => void;
}

/** Asks the person a question; resolves true for "Keep and go on". */
export type Ask = (question: { title: string; body: string; confirmLabel: string; cancelLabel: string }) => Promise<boolean>;

let waiting: StagedPanel | null = null;

/** Marks `panel` as having changes waiting; the returned function unmarks it. */
export function holdStagedPanel(panel: StagedPanel): () => void {
  waiting = panel;
  return () => {
    if (waiting === panel) waiting = null;
  };
}

export const stagedPanel = (): StagedPanel | null => waiting;

/**
 * Runs `then` once the open panel's changes are safe: at once if none wait, else after the person keeps them (put in
 * as Done does). "Stay" leaves the panel open with its changes, and `then` does not run.
 */
export function whenPanelKept(then: () => void, ask: Ask): void {
  if (!waiting) {
    then();
    return;
  }
  const { title, doneLabel = 'Done' } = waiting;
  void ask({
    title: `Keep your changes to “${title}”?`,
    body: `You changed things in this panel and haven’t pressed ${doneLabel}. Keep them in the draft and go on, or stay in the panel to finish them.`,
    confirmLabel: 'Keep and go on',
    cancelLabel: 'Stay',
  }).then((ok) => {
    const panel = waiting;
    if (!ok) {
      panel?.refocus?.();
      return;
    }
    // unmarked at once, so what `then` does next isn't asked about the same changes again
    waiting = null;
    panel?.done();
    then();
  });
}
