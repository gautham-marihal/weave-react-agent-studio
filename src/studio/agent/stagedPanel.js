import { askConfirm } from '../../ui/dialogs.js';

// The open side panel with changes waiting for Done (held by StagedDrawer), so whatever would replace it asks first
// instead of dropping them. One at a time, since a panel covers the page. Pure state, no React.
//   panel: { title, doneLabel, done(), refocus() }; done applies the changes and closes, refocus returns focus to it
let waiting = null;

// Marks `panel` as having changes waiting; the returned function unmarks it.
export function holdStagedPanel(panel) {
  waiting = panel;
  return () => {
    if (waiting === panel) waiting = null;
  };
}

export const stagedPanel = () => waiting;

// Runs `then` once the open panel's changes are safe: at once if none wait, else after the person keeps them (applied
// as Done does). Stay leaves the panel open with its changes, and `then` does not run.
export function whenPanelKept(then) {
  if (!waiting) {
    then();
    return;
  }
  const { title, doneLabel = 'Done' } = waiting;
  askConfirm({
    title: `Keep your changes to “${title}”?`,
    body: `You changed things in this panel and haven’t pressed ${doneLabel}. Keep them in the draft and go on, or stay in the panel to finish them.`,
    confirmLabel: 'Keep and go on',
    cancelLabel: 'Stay',
  }).then((ok) => {
    // the panel as it is now (it re-marks itself when its title changes)
    const panel = waiting;
    if (!ok) {
      panel?.refocus?.();
      return;
    }
    // unmark at once, so what `then` does next isn't asked about the same changes again
    waiting = null;
    panel?.done();
    then();
  });
}
