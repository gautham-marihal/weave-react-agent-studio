import React, { useCallback, useState } from 'react';
import { useBlocker, type BlockerFunction } from 'react-router-dom';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import { leavesAgent } from '../../utils/routes';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';

/**
 * Asks before leaving an agent with unsaved edits for another page of the app or another agent: Save, Discard or
 * Cancel. Closing or reloading the tab is warned about by the browser (useDraftEditor's beforeunload).
 */
export function LeaveGuard({ editor, agentId }: { editor: DraftEditor; agentId: string }) {
  const { dirty } = editor;
  const shouldBlock = useCallback<BlockerFunction>(
    ({ nextLocation }) => dirty && leavesAgent(agentId, nextLocation.pathname),
    [dirty, agentId]
  );
  const blocker = useBlocker(shouldBlock);
  const [saving, setSaving] = useState(false);
  const open = blocker.state === 'blocked';

  const cancel = () => blocker.state === 'blocked' && blocker.reset();
  const discard = () => {
    editor.discard();
    if (blocker.state === 'blocked') blocker.proceed();
  };
  const save = async () => {
    setSaving(true);
    const ok = await editor.save();
    setSaving(false);
    if (blocker.state !== 'blocked') return;
    if (ok) blocker.proceed();
    else blocker.reset(); // the conflict or the error is shown on the page; nothing is lost
  };

  return (
    <Dialog
      open={open}
      onClose={cancel}
      title="You have unsaved changes"
      description={`Leaving ${editor.config?.meta?.name || agentId} now would lose them.`}
      footer={
        <>
          <Button variant="ghost" onClick={cancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={discard} disabled={saving}>
            Discard changes
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving || !editor.canSave}>
            {saving ? 'Saving…' : 'Save and leave'}
          </Button>
        </>
      }>
      <p className="text-sm text-ink-soft">
        {editor.parseError
          ? `The JSON view has text that is not valid JSON (${editor.parseError}), so it cannot be saved. Cancel to fix it, or discard.`
          : 'Save them first, discard them, or stay on this page.'}
      </p>
    </Dialog>);

}
