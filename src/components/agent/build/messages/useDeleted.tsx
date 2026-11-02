import React, { useEffect, useState } from 'react';
import { Undo2Icon, XIcon } from 'lucide-react';
import type { AgentConfig } from '../../../../types/studio';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import { Button } from '../../../ui/Button';

interface Deleted {
  label: string;
  previous: AgentConfig;
  after: AgentConfig | null;
}

/**
 * Something just deleted, offered back with Undo until the draft changes again. `remember(label, previous)` is called
 * with the draft as it was before the deletion.
 */
export function useDeleted(editor: DraftEditor) {
  const [deleted, setDeleted] = useState<Deleted | null>(null);
  const config = editor.config;
  useEffect(() => {
    if (!deleted || !config) return;
    // the first draft other than `previous` is the one the deletion left; any later change ends the offer
    if (!deleted.after) {
      if (config !== deleted.previous) setDeleted({ ...deleted, after: config });
    } else if (config !== deleted.after) setDeleted(null);
  }, [config, deleted]);
  const notice = deleted ?
  <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-subtle px-4 py-2.5 text-[13px] text-ink">
      <span>{deleted.label}</span>
      <span className="flex items-center gap-1">
        <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          editor.replaceConfig(deleted.previous);
          setDeleted(null);
        }}>
          <Undo2Icon className="h-3.5 w-3.5" aria-hidden />
          Undo
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDeleted(null)} aria-label="Dismiss">
          <XIcon className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </span>
    </div> :
  null;
  return {
    notice,
    remember: (label: string, previous: AgentConfig) => setDeleted({ label, previous, after: null })
  };
}
