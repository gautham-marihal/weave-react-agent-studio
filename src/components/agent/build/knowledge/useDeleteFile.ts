import { useState } from 'react';
import { api, ApiError } from '../../../../api/client';

export interface DeleteResult {
  tone: 'success' | 'error';
  text: string;
}

// Deleting an uploaded file: the server is asked first without force. A file a knowledge base reads is refused (409,
// naming the base); then DeleteFileDialog warns, and only "Delete anyway" sends force=true. Shared by Build › Knowledge
// and the workspace Knowledge page; `onResult` says how it went (else `result` holds it for the screen to show).
export function useDeleteFile(agentId: string, onDeleted: (name: string) => void, onResult?: (result: DeleteResult) => void) {
  const [pending, setPending] = useState<{ name: string; reason: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<DeleteResult | null>(null);
  const report = (r: DeleteResult) => (onResult ? onResult(r) : setResult(r));
  const remove = async (name: string, force = false) => {
    setDeleting(true);
    setResult(null);
    try {
      await api.deleteKnowledgeFile(agentId, name, force);
      report({ tone: 'success', text: `${name} was deleted from the server.` });
      setPending(null);
      onDeleted(name);
    } catch (err: unknown) {
      if (!force && err instanceof ApiError && err.kind === 'conflict') setPending({ name, reason: err.message });
      else report({ tone: 'error', text: `${name} was not deleted: ${err instanceof Error ? err.message : 'the server refused it'}` });
    } finally {
      setDeleting(false);
    }
  };
  return { pending, deleting, result, remove, cancel: () => setPending(null) };
}

export type DeleteFileState = ReturnType<typeof useDeleteFile>;
