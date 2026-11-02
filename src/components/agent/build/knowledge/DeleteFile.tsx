import React from 'react';
import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';
import type { DeleteFileState } from './useDeleteFile';

/** The warning before deleting a file a knowledge base reads (the server's 409 says which base). */
export function DeleteFileDialog({ state }: { state: DeleteFileState }) {
  const { pending, deleting, remove, cancel } = state;
  return (
    <Dialog
      open={!!pending}
      onClose={() => !deleting && cancel()}
      title={`Delete ${pending?.name ?? 'this file'} anyway?`}
      description="A knowledge base reads this file."
      footer={
      <>
          <Button variant="ghost" onClick={cancel} disabled={deleting}>Keep it</Button>
          <Button variant="danger" onClick={() => pending && void remove(pending.name, true)} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete anyway'}
          </Button>
        </>
      }>
      <p className="text-sm text-ink-soft">{pending?.reason}</p>
      <p className="mt-2 text-sm text-ink-soft">
        The index already built keeps answering from it, but the next build will fail until the file is taken out of the base’s sources (or uploaded again).
      </p>
    </Dialog>);

}
