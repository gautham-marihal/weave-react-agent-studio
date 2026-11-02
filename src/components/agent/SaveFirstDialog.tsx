import React, { useState } from 'react';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';

/** "Save first?": a test or a publish uses the saved draft, so unsaved edits are saved first or the action waits. */
export function SaveFirstDialog({ editor }: { editor: DraftEditor }) {
  const pending = editor.pendingSave;
  const [saving, setSaving] = useState(false);
  const answer = async (choice: 'save' | 'cancel') => {
    if (saving) return;
    setSaving(choice === 'save');
    await editor.answerPendingSave(choice);
    setSaving(false);
  };
  return (
    <Dialog
      open={!!pending}
      onClose={() => void answer('cancel')}
      title="Save first"
      description={pending ? `${pending.action} uses the saved draft, and you have unsaved changes.` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={() => void answer('cancel')} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void answer('save')} disabled={saving || !!editor.parseError}>
            {saving ? 'Saving…' : 'Save and continue'}
          </Button>
        </>
      }>
      <p className="text-sm text-ink-soft">
        {editor.parseError
          ? `The JSON view has text that is not valid JSON (${editor.parseError}). Fix it, then save.`
          : 'Save your changes so the server has them, then carry on. Nothing is saved until you choose.'}
      </p>
    </Dialog>);

}
