import React from 'react';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import { ToolsEditor } from '../ToolsEditor';

/**
 * The Tools section's list of every tool, below the switches: open one to change how it works, add one from a card,
 * delete one (with Undo). Field problems come from the server's report on the editor's contents.
 */
export function ToolsPage({ editor, onOpenJson }: { editor: DraftEditor; onOpenJson: () => void }) {
  const config = editor.config;
  if (!config) return null;
  return (
    <section aria-label="All its tools" className="mb-8">
      <h3 className="text-sm font-semibold text-ink">All its tools</h3>
      <p className="mb-3 mt-0.5 text-[13px] text-muted">Everything it can use, what the switches above add included. Open one to change how it works.</p>
      <ToolsEditor
        config={config}
        disabled={!editor.canEdit}
        update={editor.update}
        replaceConfig={editor.canEdit ? editor.replaceConfig : undefined}
        onOpenJson={onOpenJson}
        errors={editor.validation?.errors ?? []} />
    </section>);

}
