import React, { useCallback, useState } from 'react';
import { ArrowRightLeftIcon, BookmarkPlusIcon, DownloadIcon, EyeOffIcon, PencilIcon } from 'lucide-react';
import type { Agent } from '../../types/studio';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import { useAuth } from '../../contexts/AuthContext';
import { hideAgent } from '../../models/manage';
import { ExportDialog, MoveDialog, RemoveDialog, RenameDialog, SaveTemplateDialog } from './ManageDialogs';
import type { MenuItem } from './MoreMenu';

type Kind = 'rename' | 'export' | 'template' | 'move' | 'remove';

interface Options {
  /** The agent page's editor: export and save-as-template then offer its unsaved edits too. */
  editor?: DraftEditor | null;
  onRemoved?: (agent: Agent) => void;
  onMoved?: (agent: Agent, workspaceId: string) => void;
}

/**
 * Rename, Export, Save as template, Move to workspace and Remove from my list, for any agent, from wherever its row or
 * header is. Render `element` once on the page and give `items(agent)` to a MoreMenu.
 */
export function useAgentManage({ editor, onRemoved, onMoved }: Options = {}) {
  const { can } = useAuth();
  const [open, setOpen] = useState<{ kind: Kind; agent: Agent } | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const items = useCallback(
    (agent: Agent, { dirty = false, before = [] }: { dirty?: boolean; before?: MenuItem[] } = {}): MenuItem[] => {
      const editable = can('edit') && !agent.loadError;
      return [
      ...before,
      {
        label: 'Rename…',
        icon: PencilIcon,
        onSelect: () => setOpen({ kind: 'rename', agent }),
        disabled: !editable || dirty,
        hint: !can('edit') ? 'Viewers can’t rename agents' : agent.loadError ? 'The draft could not be read' : dirty ? 'Save or discard your edits first' : undefined
      },
      { label: 'Export configuration…', icon: DownloadIcon, onSelect: () => setOpen({ kind: 'export', agent }), disabled: !!agent.loadError, hint: agent.loadError ? 'The draft could not be read' : undefined },
      { label: 'Save as template…', icon: BookmarkPlusIcon, onSelect: () => setOpen({ kind: 'template', agent }), disabled: !!agent.loadError, hint: agent.loadError ? 'The draft could not be read' : undefined },
      { label: 'Move to workspace…', icon: ArrowRightLeftIcon, onSelect: () => setOpen({ kind: 'move', agent }) },
      { divider: true },
      { label: 'Remove from my list…', icon: EyeOffIcon, danger: true, onSelect: () => setOpen({ kind: 'remove', agent }) }];

    },
    [can]
  );

  let element: React.ReactNode = null;
  if (open?.kind === 'rename') element = <RenameDialog agent={open.agent} onClose={close} />;
  else if (open?.kind === 'export') element = <ExportDialog agent={open.agent} editor={editor} onClose={close} />;
  else if (open?.kind === 'template') element = <SaveTemplateDialog agent={open.agent} editor={editor} onClose={close} />;
  else if (open?.kind === 'move') element = <MoveDialog agent={open.agent} onClose={close} onMoved={(ws) => onMoved?.(open.agent, ws)} />;
  else if (open?.kind === 'remove')
  element =
  <RemoveDialog
    agent={open.agent}
    onClose={close}
    onRemove={() => {
      hideAgent(open.agent.id);
      onRemoved?.(open.agent);
    }} />;



  return { items, element, open: (kind: Kind, agent: Agent) => setOpen({ kind, agent }) };
}
