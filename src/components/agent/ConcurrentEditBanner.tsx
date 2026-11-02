import React from 'react';
import { AlertTriangleIcon } from 'lucide-react';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import { Button } from '../ui/Button';
import { formatClock } from '../../utils/format';

/**
 * Shown when a check of GET /bots/{id}/draft finds a newer revision than the one this editor started from, i.e. someone
 * else saved while this page was open. A rejected save (409) opens ConflictDialog instead.
 */
export function ConcurrentEditBanner({ editor }: { editor: DraftEditor }) {
  const remote = editor.remoteDraft;
  if (!remote || editor.conflict) return null;
  const hasOwnEdits = editor.dirty;

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-xs text-ink"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <p className="text-ink-soft">
          <span className="font-semibold text-ink">{remote.saved_by || 'Someone'} saved a newer draft</span> at{' '}
          {formatClock(remote.saved_at)} (revision {remote.revision}; you started from {editor.baseRevision}).{' '}
          {hasOwnEdits
            ? 'Load theirs to drop your unsaved edits, or keep yours and save over theirs.'
            : 'You have no unsaved edits, so loading theirs loses nothing.'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {hasOwnEdits && (
          <Button size="sm" variant="secondary" onClick={editor.overwriteRemoteDraft}>
            Keep mine and save over theirs
          </Button>
        )}
        <Button size="sm" variant="primary" onClick={editor.loadRemoteDraft}>
          Load their draft
        </Button>
      </div>
    </div>
  );
}
