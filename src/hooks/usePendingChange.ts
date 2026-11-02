import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../components/ui/Toast';
import type { DraftEditor } from './useDraftEditor';
import { applyChange, takeChange } from '../models/pendingChange';
import { targetPath } from '../models/agentPages';

/**
 * Puts a change another page queued for this agent (see models/pendingChange.ts) into the draft editor once the draft
 * has loaded: an ordinary edit, not saved, that Undo takes back. Says so in a notice, and opens the page it names.
 */
export function usePendingChange(agentId: string, editor: DraftEditor) {
  const navigate = useNavigate();
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const ready = !!editor.agent && !!editor.config && !editor.agent.loadError;

  useEffect(() => {
    if (!ready) return;
    const change = takeChange(agentId);
    if (!change) return;
    const { config, canEdit, replaceConfig } = editorRef.current;
    if (!canEdit) {
      toast.error('The change was not made', { description: 'Your role can’t edit this agent, so the draft is as it was.' });
      return;
    }
    if (!config) return;
    const next = applyChange(config, change);
    if (next === config) {
      toast.info('Nothing to change', { description: `${change.note} It was already in the draft.` });
      return;
    }
    replaceConfig(next);
    toast.success(change.note || 'The draft was changed', {
      description: 'Not saved yet: press Save to keep it, or Undo to take it back. Nothing changed for callers.',
      duration: 10_000,
      action: { label: 'Undo', onClick: () => editorRef.current.undo() },
    });
    if (change.target) navigate(targetPath(agentId, change.target), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, ready]);
}
