import React, { useCallback, useState } from 'react';
import { hideBot } from '../agents.js';
import { ExportDialog, MoveDialog, RemoveDialog, RenameDialog, SaveTemplateDialog } from './Dialogs.jsx';

// Rename / Export / Remove for any agent, from wherever its row or header is. Render `element` once
// on the page and pass `menuItems(bot)` to a <Menu>.
export function useManage({ editor, onRenamed, onRemoved, onMoved } = {}) {
  const [dialog, setDialog] = useState(null); // { type, bot }
  const close = useCallback(() => setDialog(null), []);

  const menuItems = useCallback((bot, { dirty = false, before = [] } = {}) => [
    ...before,
    { label: 'Rename…', onClick: () => setDialog({ type: 'rename', bot }), disabled: dirty, hint: 'Save or discard your edits first' },
    { label: 'Export configuration…', onClick: () => setDialog({ type: 'export', bot }) },
    { label: 'Save as template…', onClick: () => setDialog({ type: 'template', bot }) },
    { label: 'Move to workspace…', onClick: () => setDialog({ type: 'move', bot }) },
    { divider: true },
    { label: 'Remove from my list…', danger: true, onClick: () => setDialog({ type: 'remove', bot }) },
  ], []);

  let element = null;
  if (dialog?.type === 'rename') {
    element = <RenameDialog botId={dialog.bot.id} currentName={dialog.bot.name} onClose={close} onDone={(name) => { close(); onRenamed?.(dialog.bot, name); }} />;
  } else if (dialog?.type === 'export') {
    element = <ExportDialog botId={dialog.bot.id} name={dialog.bot.name} editor={editor} onClose={close} />;
  } else if (dialog?.type === 'template') {
    element = <SaveTemplateDialog botId={dialog.bot.id} name={dialog.bot.name} editor={editor} onClose={close} />;
  } else if (dialog?.type === 'move') {
    element = <MoveDialog bot={dialog.bot} onClose={close} onDone={() => onMoved?.(dialog.bot)} />;
  } else if (dialog?.type === 'remove') {
    element = <RemoveDialog bot={dialog.bot} onClose={close} onDone={() => { hideBot(dialog.bot.id); onRemoved?.(dialog.bot); }} />;
  }
  return { element, menuItems, open: setDialog };
}
