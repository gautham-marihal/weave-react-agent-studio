import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from '../components/ui/Toast';
import {
  DatabaseIcon,
  FileTextIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { StatusChip } from '../components/ui/StatusChip';
import { Segmented } from '../components/ui/Segmented';
import { Dialog } from '../components/ui/Dialog';
import { Tooltip } from '../components/ui/Tooltip';
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
} from '../components/ui/accordion';
import { cn, inputClass, pageClass } from '../utils/styles';
import { api } from '../api/client';
import { useStudio } from '../contexts/StudioContext';
import { useBuilds, useKnowledge } from '../components/agent/build/knowledge/useKnowledge';
import { SearchPanel } from '../components/agent/build/knowledge/SearchPanel';
import { DeleteFileDialog } from '../components/agent/build/knowledge/DeleteFile';
import { useDeleteFile } from '../components/agent/build/knowledge/useDeleteFile';
import { whenInWords } from '../components/agent/build/knowledge/words';
import {
  ACCEPT_ATTRIBUTE,
  STATE_TEXT,
  baseState,
  fileTypeProblem,
  isBuilding,
  lastLog,
  sizeInWords,
  usedByInWords,
  type KnowledgeBaseView,
  type KnowledgeFileView,
} from '../models/knowledge';

type Tab = 'search' | 'bases' | 'files';

export function Knowledge() {
  const { agents, getAgent } = useStudio();
  const [tab, setTab] = useState<Tab>('search');

  // Agent selector: the agent named in the address (?agent=), else the first one; none until the list has arrived.
  const [params] = useSearchParams();
  const [selectedAgentId, setSelectedAgentId] = useState<string>(() => params.get('agent') || agents[0]?.id || '');

  useEffect(() => {
    if (agents.length > 0 && !agents.some((a) => a.id === selectedAgentId)) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  // The agent's knowledge as the server has it (shared with Build › Knowledge), in the order shown here.
  const knowledge = useKnowledge(selectedAgentId);
  const loading = knowledge.refreshing;
  const [bases, setBases] = useState<KnowledgeBaseView[]>([]);
  const [files, setFiles] = useState<KnowledgeFileView[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState<string>('');
  useEffect(() => {
    const loaded = knowledge.data?.bases ?? [];
    setBases(loaded);
    setFiles(knowledge.data?.files ?? []);
    setSelectedBaseId((current) => (loaded.some((b) => b.id === current) ? current : loaded[0]?.id ?? ''));
  }, [knowledge.data]);
  const fetchKnowledge = () => void knowledge.reload();

  // Builds are followed until they end (shared with Build › Knowledge).
  const { builds, errors: buildErrors, start } = useBuilds(selectedAgentId, {
    onDone: (baseId, build) => {
      if (build?.status === 'failed') toast.error('Build failed', { description: build.error || 'The server did not say why.' });
      else toast.success(`Index built for ${baseId}`);
      fetchKnowledge();
    },
  });

  // Upload Dialog State
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [uploading, setUploading] = useState(false);

  // Pagination for Accordions
  const [basesPage, setBasesPage] = useState(1);
  const [basesPageSize, setBasesPageSize] = useState(5);
  const [filesPage, setFilesPage] = useState(1);
  const [filesPageSize, setFilesPageSize] = useState(5);

  const selectedBase = useMemo(() => bases.find((b) => b.id === selectedBaseId) ?? bases[0], [bases, selectedBaseId]);
  // the search reads the base's settings from the agent's saved draft
  const savedConfig = getAgent(selectedAgentId)?.draft.config;
  const savedBase = (Array.isArray(savedConfig?.knowledge) ? (savedConfig?.knowledge as Array<{ id?: string; mode?: string; top_k?: number; retrieval?: { min_score?: number } }>) : []).find(
    (b) => b?.id === selectedBase?.id
  );

  const handleStartBuild = async (baseId: string) => {
    await start(baseId);
    toast.info('Building the index');
  };

  const handleUploadSubmit = async () => {
    const name = uploadedFileName.trim();
    if (!name || !uploadedFile) return;
    const bad = fileTypeProblem(name);
    if (bad) {
      toast.error('Upload refused', { description: bad });
      return;
    }
    setUploading(true);
    try {
      await api.uploadKnowledgeFile(selectedAgentId, name, uploadedFile);
      toast.success(`File ${name} uploaded`);
      setUploadOpen(false);
      setUploadedFile(null);
      setUploadedFileName('');
      fetchKnowledge();
    } catch (err: unknown) {
      toast.error('Upload failed', { description: err instanceof Error ? err.message : 'Upload rejected by server.' });
    } finally {
      setUploading(false);
    }
  };

  // Deleting asks the server first without force; a file a knowledge base reads is only deleted after a warning.
  const deletion = useDeleteFile(selectedAgentId, fetchKnowledge, (r) => (r.tone === 'success' ? toast.success(r.text) : toast.error(r.text)));

  return (
    <div className={pageClass}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Knowledge</h1>
          <p className="mt-1 text-sm text-muted">
            Vector stores, documents, and real semantic search backed by the Agent Builder API.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs text-muted flex items-center gap-2">
            Agent:
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className={cn(inputClass, 'w-auto py-1 text-xs')}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.id})
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" size="sm" onClick={fetchKnowledge} disabled={loading}>
            <RefreshCwIcon className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setUploadOpen(true)}>
            <PlusIcon className="h-4 w-4" aria-hidden />
            Upload file
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <Segmented
          label="Knowledge View"
          options={[
            { value: 'search', label: 'Semantic Search Test' },
            { value: 'bases', label: `Knowledge Bases (${bases.length})` },
            { value: 'files', label: `Uploaded Files (${files.length})` },
          ]}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
        />
      </div>

      {knowledge.error && (
        <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          The knowledge could not be read: {knowledge.error}
        </p>
      )}

      {tab === 'search' && (
        <div className="mt-6 space-y-6">
          <div className="rounded-xl border border-line bg-surface p-6 shadow-panel">
            <h2 className="text-base font-semibold text-ink">Semantic Search Try-It</h2>
            <p className="mt-1 text-sm text-muted">
              Test what passages your agent retrieves for a customer query using real vector search.
            </p>

            {bases.length === 0 || !selectedBase ? (
              <div className="mt-6 rounded-lg border border-line bg-subtle p-6 text-center text-sm text-muted">
                No knowledge base configured for {selectedAgentId} yet. Define a knowledge base in your bot configuration or select another agent.
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {bases.length > 1 && (
                  <label className="flex items-center gap-2 text-xs text-muted">
                    Base:
                    <select value={selectedBase.id} onChange={(e) => setSelectedBaseId(e.target.value)} className={cn(inputClass, 'w-auto py-1 text-xs')}>
                      {bases.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.id}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <SearchPanel
                  key={`${selectedAgentId}/${selectedBase.id}`}
                  agentId={selectedAgentId}
                  baseId={selectedBase.id}
                  settings={{ mode: savedBase?.mode || selectedBase.mode, topK: savedBase?.top_k, minScore: savedBase?.retrieval?.min_score }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'bases' && (
        <div className="mt-6 space-y-6">
          {bases.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface p-12 text-center text-sm text-muted">
              No knowledge bases defined in this bot’s draft configuration.
            </div>
          ) : (
            <Accordion
              items={bases.slice((basesPage - 1) * basesPageSize, basesPage * basesPageSize)}
              onReorder={(newItems) => {
                const startAt = (basesPage - 1) * basesPageSize;
                const next = [...bases];
                next.splice(startAt, newItems.length, ...newItems);
                setBases(next);
              }}
              enableReordering={true}
              enableDragAndDrop={true}
              pagination={{
                page: basesPage,
                pageSize: basesPageSize,
                totalItems: bases.length,
                onPageChange: (p) => setBasesPage(p),
                onPageSizeChange: (s) => {
                  setBasesPageSize(s);
                  setBasesPage(1);
                },
                pageSizeOptions: [3, 5, 10],
              }}
            >
              {bases.slice((basesPage - 1) * basesPageSize, basesPage * basesPageSize).map((base, idx, arr) => {
                const live = builds[base.id] || base.build;
                const building = isBuilding(live);
                const state = STATE_TEXT[baseState({ ...base, build: live })];
                return (
                  <AccordionItem
                    key={base.id}
                    id={base.id}
                    index={idx}
                    isFirst={idx === 0}
                    isLast={idx === arr.length - 1}
                  >
                    <AccordionHeader
                      id={base.id}
                      icon={<DatabaseIcon className="h-4 w-4 text-accent" />}
                      title={base.id}
                      subtitle={`Type: ${base.type} · Mode: ${base.mode}`}
                      badge={
                        <StatusChip tone={state.tone} dot title={state.hint}>
                          {state.label}
                        </StatusChip>
                      }
                      actions={
                        base.buildable ? (
                          <Tooltip content="Build and sync vector embeddings" position="top">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleStartBuild(base.id)}
                              disabled={building}
                              className="h-8 px-2.5 text-xs"
                            >
                              {building ? (
                                <>
                                  <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin mr-1" />
                                  Building…
                                </>
                              ) : (
                                'Build Index'
                              )}
                            </Button>
                          </Tooltip>
                        ) : undefined
                      }
                    />

                    <AccordionContent>
                      <div className="space-y-4">
                        {live && live.log.length > 0 && (
                          <div className="rounded-lg bg-black/90 p-3 font-mono text-xs text-green-400" aria-live="polite">
                            {(building ? [lastLog(live)] : live.log).map((l, i) => (
                              <p key={i}>{l}</p>
                            ))}
                          </div>
                        )}
                        {live?.status === 'failed' && <p className="text-xs text-danger">The last build failed: {live.error || 'no reason was given.'}</p>}
                        {buildErrors[base.id] && <p className="text-xs text-danger">{buildErrors[base.id]}</p>}

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                          <div className="rounded-lg border border-line bg-surface p-3">
                            <span className="text-muted block">Sources</span>
                            <span className="text-ink font-semibold mt-1 block">
                              {base.sources.length} {base.sources.length === 1 ? 'source' : 'sources'}
                            </span>
                          </div>
                          <div className="rounded-lg border border-line bg-surface p-3">
                            <span className="text-muted block">Used by</span>
                            <span className="text-ink font-semibold mt-1 block truncate">
                              {usedByInWords(base.usedBy)}
                            </span>
                          </div>
                          <div className="rounded-lg border border-line bg-surface p-3">
                            <span className="text-muted block">Embedding Key</span>
                            <span className={cn('font-semibold mt-1 block', base.keyAvailable ? 'text-success' : 'text-warning')}>
                              {base.keyAvailable ? 'Available' : 'Missing'}
                            </span>
                          </div>
                          <div className="rounded-lg border border-line bg-surface p-3">
                            <span className="text-muted block">Index</span>
                            <span className="text-ink font-semibold mt-1 block">
                              {base.index ? `${base.index.passages} passages` : base.buildable ? 'Not built' : 'Nothing to build'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </div>
      )}

      {tab === 'files' && (
        <div className="mt-6">
          {files.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface p-12 text-center text-sm text-muted">
              No files uploaded for {selectedAgentId} yet. Click "Upload file" to add guides, FAQs, or markdown.
            </div>
          ) : (
            <Accordion
              items={files.slice((filesPage - 1) * filesPageSize, filesPage * filesPageSize)}
              getId={(file: KnowledgeFileView) => file.name}
              onReorder={(newItems) => {
                const startAt = (filesPage - 1) * filesPageSize;
                const next = [...files];
                next.splice(startAt, newItems.length, ...newItems);
                setFiles(next);
              }}
              enableReordering={true}
              enableDragAndDrop={true}
              pagination={{
                page: filesPage,
                pageSize: filesPageSize,
                totalItems: files.length,
                onPageChange: (p) => setFilesPage(p),
                onPageSizeChange: (s) => {
                  setFilesPageSize(s);
                  setFilesPage(1);
                },
                pageSizeOptions: [5, 10, 20],
              }}
            >
              {files.slice((filesPage - 1) * filesPageSize, filesPage * filesPageSize).map((file, idx, arr) => (
                <AccordionItem
                  key={file.name}
                  id={file.name}
                  index={idx}
                  isFirst={idx === 0}
                  isLast={idx === arr.length - 1}
                >
                  <AccordionHeader
                    id={file.name}
                    icon={<FileTextIcon className="h-4 w-4 text-muted" />}
                    title={file.name}
                    subtitle={whenInWords(file.modified) ? `Modified: ${whenInWords(file.modified)}` : undefined}
                    badge={
                      <span className="rounded bg-subtle px-2 py-0.5 font-mono text-[11px] text-muted font-medium">
                        {sizeInWords(file.size)}
                      </span>
                    }
                    actions={
                      <Tooltip content={`Delete file ${file.name}`} position="top">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void deletion.remove(file.name)}
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                          aria-label={`Delete ${file.name}`}
                        >
                          <Trash2Icon className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                    }
                  />

                  <AccordionContent>
                    <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
                      <div>
                        <p className="font-medium text-ink">Read by</p>
                        <p className="text-muted mt-0.5">{file.usedBy.length ? file.usedBy.join(', ') : 'No knowledge base lists this file yet.'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-muted text-[11px]">{file.size ?? '?'} bytes</span>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload Knowledge Document"
        description="Upload a text, markdown, HTML, PDF, CSV or JSON document directly to this bot on the Agent Builder server."
        footer={
          <>
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleUploadSubmit} disabled={!uploadedFile || !uploadedFileName.trim() || uploading}>
              {uploading ? (
                <>
                  <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden />
                  Uploading…
                </>
              ) : (
                'Upload'
              )}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-ink-soft block">Choose file from disk</label>
            <input
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setUploadedFile(f);
                  setUploadedFileName(f.name);
                }
              }}
              className="mt-1 text-xs text-muted"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-ink-soft block">File Name on Server</label>
            <input
              type="text"
              value={uploadedFileName}
              onChange={(e) => setUploadedFileName(e.target.value)}
              placeholder="e.g. faq_customer_guide.md"
              className={cn(inputClass, 'mt-1 text-sm')}
            />
          </div>
        </div>
      </Dialog>
      <DeleteFileDialog state={deletion} />
    </div>
  );
}
