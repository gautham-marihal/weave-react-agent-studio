import { askConfirm } from '../../ui/dialogs.js';

// The side panel that is open with changes still waiting for Done (StagedDrawer, Drawer.jsx, holds it here; one at a time, since a panel covers the
// page), so whatever is about to replace it (a search result that opens another panel or another page of the agent) asks first instead of dropping
// them. Pure state, no React.
//   panel: { title, doneLabel, done(), refocus() }   done puts the changes into the draft and closes the panel; refocus gives the panel the keyboard back
let waiting = null;

// Marks `panel` as the one with changes waiting; the function it returns unmarks it (when its changes are put in or dropped, or it closes).
export function holdStagedPanel(panel) {
  waiting = panel;
  return () => {
    if (waiting === panel) waiting = null;
  };
}

export const stagedPanel = () => waiting;

// Runs `then` once the open panel's changes are safe: at once when no panel has any waiting, else after the person chooses to keep them (they go into
// the draft, as Done does, and then `then` runs). Stay leaves the panel open as it was, with its changes, and `then` does not run.
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
    // the panel as it is now (it marks itself again when its title changes)
    const panel = waiting;
    if (!ok) {
      panel?.refocus?.();
      return;
    }
    // unmarked at once, so what `then` does next (open another panel) isn't asked about the same changes again
    waiting = null;
    panel?.done();
    then();
  });
}
