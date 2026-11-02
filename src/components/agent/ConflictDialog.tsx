import React, { useMemo } from 'react';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { ChangeList } from './ChangeList';
import { diffConfigs } from '../../utils/diff';
import { plainChanges } from '../../models/changes';
import { formatClock } from '../../utils/format';

export function ConflictDialog({ editor }: {editor: DraftEditor;}) {
  const { conflict, config } = editor;
  const changes = useMemo(() => plainChanges(conflict && config ? diffConfigs(conflict.config, config) : []), [conflict, config]);

  return (
    <Dialog
      open={!!conflict}
      onClose={() => undefined}
      size="lg"
      title="Someone else saved this agent while you were editing"
      description={
      conflict ?
      <>
            {conflict.saved_by} saved revision {conflict.revision} at {formatClock(conflict.saved_at)}. Nothing was overwritten — your edits are still here. Choose which version to keep.
          </> :
      null
      }
      footer={
      <>
          <Button variant="secondary" onClick={() => editor.resolveConflict('theirs')}>
            Use {conflict?.saved_by.split(' ')[0]}’s version
          </Button>
          <Button variant="primary" onClick={() => editor.resolveConflict('mine')}>
            Keep mine and overwrite
          </Button>
        </>
      }>
      
      <p className="mb-4 text-sm text-ink-soft">
        What your edits change compared with what they saved. Keeping yours replaces their changes; using theirs discards yours.
      </p>
      <ChangeList summary={changes} emptyText="Your edits match what they saved." />
    </Dialog>);

}