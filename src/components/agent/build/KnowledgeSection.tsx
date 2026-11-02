import React, { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { BookOpenIcon, RefreshCwIcon } from 'lucide-react';
import type { DraftEditor } from '../../../hooks/useDraftEditor';
import { attachBase, isBuilding, knowledgeSummary } from '../../../models/knowledge';
import { loadFacts } from '../../../utils/agentFacts';
import { Button } from '../../ui/Button';
import { useBuilds, useKnowledge } from './knowledge/useKnowledge';
import { BaseCard } from './knowledge/BaseCard';
import { FilesCard } from './knowledge/FilesCard';
import { DeleteFileDialog } from './knowledge/DeleteFile';
import { useDeleteFile } from './knowledge/useDeleteFile';

/**
 * Every knowledge base of the agent, as the server has it (GET /bots/{id}/knowledge on the saved draft) next to what
 * the editor holds: base cards with their index, Build (followed until it ends), a real search with scores, who reads
 * each base and "How it searches"; the files on the server with upload and delete. The server builds and searches the
 * SAVED draft, so unsaved edits are said and Build saves first.
 */
export function KnowledgeSection({ editor }: { editor: DraftEditor }) {
  const agentId = editor.agent?.id ?? '';
  const knowledge = useKnowledge(agentId);
  const { data, reload } = knowledge;
  const inputRef = useRef<HTMLInputElement>(null);
  const refresh = () => {
    void reload();
    // the header's readiness and the Overview read the same knowledge
    if (agentId) void loadFacts(agentId, { force: true });
  };
  const { builds, errors, start, follow } = useBuilds(agentId, { onDone: refresh });
  const deletion = useDeleteFile(agentId, refresh);

  // read again once the draft is saved (from anywhere: the header, Ctrl+S), so bases follow what the server has
  const savedAt = editor.savedAt;
  const seen = useRef(savedAt);
  useEffect(() => {
    if (seen.current !== savedAt) refresh();
    seen.current = savedAt;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAt]);

  // a base that was already building when the screen opened (or from another tab) is followed too
  useEffect(() => {
    (data?.bases ?? []).forEach((b) => {
      if (isBuilding(b.build) && !builds[b.id]) follow(b.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const config = editor.config;
  const draftIds = useMemo(
    () => (Array.isArray(config?.knowledge) ? (config?.knowledge as Array<{ id?: unknown }>) : []).map((b) => (typeof b?.id === 'string' ? b.id : '')).filter(Boolean),
    [config]
  );
  if (!config) return null;

  const serverIds = (data?.bases ?? []).map((b) => b.id);
  const ids = [...serverIds, ...draftIds.filter((id) => !serverIds.includes(id))];
  const unsaved = editor.dirty || (!!data && JSON.stringify([...draftIds].sort()) !== JSON.stringify([...serverIds].sort()));
  const summary = knowledgeSummary(data);

  const build = async (baseId: string) => {
    // the server builds what is saved: unsaved edits are saved first
    if (!(await editor.ensureSaved('Building the index'))) return;
    await start(baseId);
  };

  return (
    <div className="space-y-4">
      {data && !data.keyAvailable &&
      <p role="note" className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-ink-soft">
          <strong className="font-medium text-ink">This server can’t build indexes yet.</strong> It has no key for the embedding model, so building is refused.
          Whoever runs the server has to set it; searching an index that is already built still works.
        </p>
      }
      {unsaved &&
      <div role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-[13px] text-ink-soft">
          <span>
            <strong className="font-medium text-ink">Knowledge works from the saved draft.</strong> The server builds and searches what is saved, not what is in the
            editor. Save to include your latest changes to the bases.
          </span>
          {editor.canEdit &&
        <Button size="sm" variant="secondary" disabled={!editor.canSave || editor.saveState === 'saving'} onClick={() => void editor.save()}>
              {editor.saveState === 'saving' ? 'Saving…' : 'Save draft'}
            </Button>
        }
        </div>
      }
      {knowledge.error &&
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px]">
          <span className="text-danger">The knowledge could not be read: {knowledge.error}</span>
          <Button size="sm" variant="secondary" onClick={refresh}>
            <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden />
            Try again
          </Button>
        </div>
      }
      {knowledge.loading &&
      <div className="space-y-3" aria-busy="true" aria-label="Loading the knowledge">
          {[0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl border border-line bg-subtle/60" />)}
        </div>
      }

      {data && summary.total > 0 &&
      <p role="status" className="text-[13px] text-muted">
          {summary.total} {summary.total === 1 ? 'base' : 'bases'} on the server: <span className="font-medium text-success">{summary.ready} ready</span>
          {summary.needsBuild > 0 && <>, <span className="font-medium text-danger">{summary.needsBuild} {summary.needsBuild === 1 ? 'needs' : 'need'} building</span></>}
          {summary.building > 0 && <>, {summary.building} building</>}.
        </p>
      }

      {data && ids.length === 0 &&
      <div className="rounded-xl border border-dashed border-line px-6 py-8 text-center">
          <BookOpenIcon className="mx-auto h-6 w-6 text-muted" aria-hidden />
          <p className="mt-2 text-sm font-medium text-ink">No knowledge bases yet</p>
          <p className="mt-1 text-[13px] text-muted">Upload a file below and it becomes what this agent knows. Save the draft, then build the index.</p>
        </div>
      }

      {data && ids.map((id) =>
      <BaseCard
        key={id}
        agentId={agentId}
        baseId={id}
        base={data.bases.find((b) => b.id === id) ?? null}
        config={config}
        build={builds[id]}
        buildError={errors[id]}
        canEdit={editor.canEdit}
        onBuild={(baseId) => void build(baseId)}
        onAttach={(baseId) => editor.replaceConfig(attachBase(config, baseId))}
        onUpload={() => inputRef.current?.click()} />

      )}

      {data && <FilesCard agentId={agentId} editor={editor} files={data.files} inputRef={inputRef} onChanged={refresh} onDelete={(name) => void deletion.remove(name)} />}
      <DeleteFileDialog state={deletion} />
      {deletion.result &&
      <p role={deletion.result.tone === 'error' ? 'alert' : 'status'} className={deletion.result.tone === 'error' ? 'text-[13px] text-danger' : 'text-[13px] text-success'}>
          {deletion.result.text}
        </p>
      }

      <p className="text-[13px] text-muted">
        Every agent’s knowledge is also on the{' '}
        <Link to={`/knowledge?agent=${encodeURIComponent(agentId)}`} className="font-medium text-accent hover:underline">Knowledge page</Link>.
      </p>
    </div>);

}
