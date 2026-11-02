import React, { useRef } from 'react';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import { useChangesSincePublished } from '../../hooks/usePublishedChanges';
import { revertSection, sectionTitle } from '../../models/changes';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { toast } from '../ui/Toast';
import { ChangeList } from './ChangeList';

/** The list of unpublished changes, each part with "Put back as published" (an ordinary edit: Undo takes it back). */
export function ChangesDialog({ editor, open, onClose }: { editor: DraftEditor; open: boolean; onClose: () => void }) {
  const { config: published, error, version, summary } = useChangesSincePublished(editor);
  const undo = useRef(editor.undo);
  undo.current = editor.undo;

  const putBack = (key: string) => {
    if (!editor.config) return;
    editor.replaceConfig(revertSection(editor.config, published, key));
    toast.success(`${sectionTitle(key)} is back as published (v${version})`, {
      description: 'Nothing is saved until you press Save.',
      action: { label: 'Undo', onClick: () => undo.current() },
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={version ? `Changes since v${version}` : 'Not published yet'}
      description={version ? 'What the draft in the editor changes compared with the newest published version. Version numbers, dates and layout notes are left out.' : 'There is no published version to compare with.'}
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      {error ?
      <p role="alert" className="text-sm text-danger">The published version could not be read: {error}</p> :
      version && !published ?
      <div className="space-y-2" aria-busy="true">
          <div className="h-4 w-2/3 animate-pulse rounded bg-subtle" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-subtle" />
        </div> :
      <ChangeList summary={summary} emptyText="The draft is the same as the published version." onPutBack={published && editor.canEdit ? putBack : undefined} />
      }
    </Dialog>);

}
